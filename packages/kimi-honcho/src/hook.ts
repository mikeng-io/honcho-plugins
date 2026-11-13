import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  loadConfig, sessionName, honchoSessionUrl, textOf, readPayload, honchoDir,
  materialize, getPeerContext, renderPeerCard, DIRECTIVES,
  enqueue, flush, readCursor, writeCursor,
  readCache, writeCache, hasInjected, markInjected,
} from "../../core/src/index.ts";

const HOST = "kimi";
const KIMI_HOME = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
const verb = process.argv[2] || "status";

function cwdOf(p: any): string {
  return p.cwd || process.cwd();
}

async function inject(p: any): Promise<void> {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled) return;
  const cwd = cwdOf(p);
  const name = sessionName(cfg, cwd, p.session_id);
  const key = p.session_id || name;

  await materialize(cfg, name, cwd);

  let ctx = readCache(HOST, key);
  if (!ctx) {
    ctx = await getPeerContext(cfg);
    writeCache(HOST, key, ctx);
  }
  const block = renderPeerCard(ctx, cfg.peerName);
  const link = `View this session in Honcho: ${honchoSessionUrl(cfg.workspace, name)}`;
  markInjected(HOST, key);
  if (block) console.log([block, DIRECTIVES, link].join("\n"));
}

// UserPromptSubmit stdout IS appended to context. If SessionStart output was
// discarded (headless runs), inject the peer card once here instead.
async function prompt(p: any): Promise<void> {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled) return;
  const cwd = cwdOf(p);
  const key = p.session_id || sessionName(cfg, cwd, p.session_id);
  if (hasInjected(HOST, key)) return;
  let ctx = readCache(HOST, key);
  if (!ctx) {
    try {
      ctx = await getPeerContext(cfg);
      writeCache(HOST, key, ctx);
    } catch {
      return; // fail-open: no memory this session rather than a broken turn
    }
  }
  const block = renderPeerCard(ctx, cfg.peerName);
  if (block) console.log(`${block}\n${DIRECTIVES}`);
  markInjected(HOST, key);
}

function findWire(sessionId: string): string | null {
  if (!sessionId) return null;
  try {
    for (const line of readFileSync(join(KIMI_HOME, "session_index.jsonl"), "utf8").split("\n")) {
      try {
        const j = JSON.parse(line);
        if (j.sessionId === sessionId && j.sessionDir) {
          const wire = join(j.sessionDir, "agents", "main", "wire.jsonl");
          if (existsSync(wire)) return wire;
        }
      } catch {}
    }
  } catch {}
  const root = join(KIMI_HOME, "sessions");
  try {
    for (const ws of readdirSync(root)) {
      const wire = join(root, ws, sessionId, "agents", "main", "wire.jsonl");
      if (existsSync(wire)) return wire;
    }
  } catch {}
  return null;
}

function extractMessages(data: string): { role: "user" | "assistant"; text: string; at: number }[] {
  const out: { role: "user" | "assistant"; text: string; at: number }[] = [];
  for (const line of data.split("\n")) {
    if (!line) continue;
    let j: any;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type !== "agent.message.appended") continue;
    const m = j.message?.message;
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const text = textOf(m.content).trim();
    if (text) out.push({ role: m.role, text, at: j.time || Date.now() });
  }
  return out;
}

const msgHash = (m: { role: string; text: string }) =>
  createHash("sha1").update(m.role + "\0" + m.text).digest("hex");

// Local-first capture of the wire.jsonl delta, with replay dedupe on resume.
function capture(key: string, wirePath: string): number {
  let data: string;
  try {
    data = readFileSync(wirePath, "utf8");
  } catch {
    return 0;
  }
  const size = Buffer.byteLength(data);
  const cur = readCursor(HOST, key);
  const from = cur.offset > 0 && cur.offset <= size ? cur.offset : 0;

  let pos = 0;
  let sliceStart: number | null = null;
  const lines: string[] = [];
  for (const line of data.split("\n")) {
    const len = Buffer.byteLength(line) + 1;
    if (sliceStart === null && pos + len > from) sliceStart = pos;
    if (sliceStart !== null) lines.push(line);
    pos += len;
  }
  const fresh = extractMessages(lines.join("\n"));

  let skip = 0;
  const maxK = Math.min(fresh.length, cur.hashes.length, 1000);
  outer: for (let k = maxK; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      if (msgHash(fresh[i]) !== cur.hashes[cur.hashes.length - k + i]) continue outer;
    }
    skip = k;
    break;
  }
  const news = fresh.slice(skip);
  if (news.length) enqueue(HOST, key, news);
  writeCursor(HOST, key, {
    offset: size,
    hashes: cur.hashes.concat(news.map(msgHash)).slice(-1000),
  });
  return news.length;
}

async function writeback(p: any): Promise<void> {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled || !cfg.saveMessages) return;
  if (!p.session_id) return;
  const cwd = cwdOf(p);
  const name = sessionName(cfg, cwd, p.session_id);
  const key = p.session_id || name;
  const wire = findWire(p.session_id);
  if (wire) capture(key, wire);
  try {
    await flush(cfg, HOST, key, name);
  } catch {}
  // No stdout: Stop-hook output must not extend the turn.
}

function status(): void {
  const cfg = loadConfig(HOST);
  if (!cfg) {
    console.log("no honcho config (set apiKey in ~/.honcho/config.json)");
    return;
  }
  const { apiKey, sessions, ...rest } = cfg;
  console.log("config:", JSON.stringify({ ...rest, apiKey: apiKey.slice(0, 8) + "…" }, null, 2));
  const dir = join(honchoDir(), HOST, "queue");
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      console.log(`queue ${f}: ${readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).length} pending`);
    }
  } catch {
    console.log("queues: empty");
  }
}

try {
  const payload = await readPayload();
  if (verb === "recall") await inject(payload);
  else if (verb === "prompt") await prompt(payload);
  else if (verb === "writeback" || verb === "flush") await writeback(payload);
  else if (verb === "status") status();
} catch (e: any) {
  process.stderr.write(`honcho:${verb}: ${e?.message || e}\n`);
}
process.exit(0);
