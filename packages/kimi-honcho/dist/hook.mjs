// packages/kimi-honcho/src/hook.ts
import { readFileSync as readFileSync4, existsSync as existsSync3, readdirSync } from "node:fs";
import { join as join4 } from "node:path";
import { homedir as homedir2 } from "node:os";
import { createHash } from "node:crypto";

// packages/core/src/config.ts
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
var STORE = () => process.env.HONCHO_CONFIG_DIR || join(homedir(), ".honcho");
function honchoDir() {
  return STORE();
}
function loadConfig(host) {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(join(STORE(), "config.json"), "utf8"));
  } catch {
    return null;
  }
  const hostBlock = raw.hosts?.[host] || {};
  const apiKey = process.env.HONCHO_API_KEY || hostBlock.apiKey || raw.apiKey;
  if (!apiKey)
    return null;
  const peerName = process.env.HONCHO_PEER_NAME || raw.peerName || process.env.USER || process.env.USERNAME || "user";
  const globalOverride = raw.globalOverride === true;
  const pick = (k, fb) => globalOverride ? raw[k] ?? fb : hostBlock[k] ?? raw[k] ?? fb;
  const endpoint = globalOverride ? raw.endpoint : hostBlock.endpoint ?? raw.endpoint;
  let baseUrl = endpoint?.baseUrl || (endpoint?.environment === "local" ? "http://localhost:8000" : "https://api.honcho.dev");
  if (!baseUrl.endsWith("/v3"))
    baseUrl = baseUrl.replace(/\/+$/, "") + "/v3";
  return {
    apiKey,
    peerName,
    workspace: pick("workspace", host),
    aiPeer: pick("aiPeer", host),
    enabled: (hostBlock.enabled ?? raw.enabled) !== false,
    saveMessages: (hostBlock.saveMessages ?? raw.saveMessages) !== false,
    sessionStrategy: pick("sessionStrategy", "chat-instance"),
    sessions: raw.sessions || {},
    baseUrl
  };
}
var slug = (s) => s.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
var fkey = (k) => slug(String(k)).slice(0, 80) || "default";
function currentBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim() || null;
  } catch {
    return null;
  }
}
function repoName(cwd) {
  try {
    const top = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
    if (top)
      return slug(basename(top));
  } catch {}
  return slug(basename(cwd));
}
function sessionName(cfg, cwd, sessionId) {
  const override = cfg.sessions[cwd];
  if (override)
    return override;
  const repo = slug(basename(cwd));
  switch (cfg.sessionStrategy) {
    case "per-directory":
      return repo;
    case "git-branch": {
      const branch = currentBranch(cwd);
      return branch ? `${repo}-${slug(branch)}` : repo;
    }
    case "chat-instance":
    default:
      return sessionId ? `${repo}-${slug(sessionId).slice(0, 12)}` : repo;
  }
}
function honchoSessionUrl(workspace, session) {
  return `https://app.honcho.dev/explore?workspace=${encodeURIComponent(workspace)}&view=sessions&session=${encodeURIComponent(session)}`;
}
// packages/core/src/honcho.ts
import { hostname } from "node:os";
async function honcho(cfg, path, opts = {}) {
  const { method = "GET", body, query, timeoutMs = 8000 } = opts;
  const url = new URL(`${cfg.baseUrl}/workspaces/${encodeURIComponent(cfg.workspace)}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null)
        url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      ...body ? { "Content-Type": "application/json" } : {}
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok)
    throw new Error(`${method} ${url.pathname} → HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function getPeerContext(cfg, maxConclusions = 8) {
  const c = await honcho(cfg, `/peers/${encodeURIComponent(cfg.peerName)}/context`, {
    query: { max_conclusions: maxConclusions, include_most_frequent: true }
  });
  return { representation: c?.representation ?? null, peerCard: c?.peer_card ?? null, at: Date.now() };
}
async function materialize(cfg, name, cwd) {
  await Promise.all([
    honcho(cfg, "/peers", { method: "POST", body: { id: cfg.peerName } }),
    honcho(cfg, "/peers", { method: "POST", body: { id: cfg.aiPeer } }),
    honcho(cfg, "/sessions", { method: "POST", body: { id: name } })
  ]);
  await honcho(cfg, `/sessions/${encodeURIComponent(name)}/peers`, {
    method: "POST",
    body: { [cfg.peerName]: {}, [cfg.aiPeer]: {} }
  });
  const scopes = [repoName(cwd), hostname()].filter(Boolean);
  for (const scope of scopes) {
    try {
      await honcho(cfg, "/scopes", { method: "POST", body: { id: scope } });
      await honcho(cfg, `/scopes/${encodeURIComponent(scope)}/sessions`, {
        method: "POST",
        body: { session_ids: [name] }
      });
    } catch {}
  }
}
// packages/core/src/stdin.ts
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY)
      return resolve("");
    let s = "";
    process.stdin.on("data", (c) => s += c);
    process.stdin.on("end", () => resolve(s));
    process.stdin.on("error", () => resolve(s));
  });
}
function textOf(input) {
  if (typeof input === "string")
    return input;
  if (Array.isArray(input)) {
    return input.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join(`
`);
  }
  return "";
}
async function readPayload() {
  const stdin = await readStdin();
  try {
    return JSON.parse(stdin);
  } catch {
    return {};
  }
}
// packages/core/src/render.ts
var DIRECTIVES = "This is persistent cross-session memory about the user, maintained automatically " + "by Honcho. Trust it and act on it — do not ask the user about things it already covers. " + "For anything task-specific, recall on demand with the host's recall command " + "(see the honcho-memory skill) instead of guessing.";
function renderPeerCard(ctx, peerName) {
  if (!ctx || !Array.isArray(ctx.peerCard) || !ctx.peerCard.length)
    return "";
  return `<honcho-memory peer="${peerName}">
Profile: ${ctx.peerCard.join("; ")}
</honcho-memory>`;
}
// packages/core/src/queue.ts
import { readFileSync as readFileSync2, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join as join2 } from "node:path";
var queueDir = (host) => join2(honchoDir(), host, "queue");
var queuePath = (host, key) => join2(queueDir(host), `${fkey(key)}.jsonl`);
var cursorPath = (host, key) => join2(queueDir(host), `${fkey(key)}.cursor.json`);
function enqueue(host, key, entries) {
  if (!entries.length)
    return;
  mkdirSync(queueDir(host), { recursive: true });
  appendFileSync(queuePath(host, key), entries.map((m) => JSON.stringify(m)).join(`
`) + `
`);
}
function readCursor(host, key) {
  try {
    const c = JSON.parse(readFileSync2(cursorPath(host, key), "utf8"));
    return { offset: c.offset || 0, hashes: Array.isArray(c.hashes) ? c.hashes : [] };
  } catch {
    return { offset: 0, hashes: [] };
  }
}
function writeCursor(host, key, cursor) {
  mkdirSync(queueDir(host), { recursive: true });
  writeFileSync(cursorPath(host, key), JSON.stringify(cursor));
}
async function flush(cfg, host, key, sessionName2) {
  const qp = queuePath(host, key);
  if (!existsSync(qp))
    return 0;
  const pending = readFileSync2(qp, "utf8").split(`
`).filter(Boolean);
  if (!pending.length)
    return 0;
  const messages = pending.map((l) => {
    const m = JSON.parse(l);
    return {
      content: m.text.slice(0, 25000),
      peer_id: m.role === "assistant" ? cfg.aiPeer : cfg.peerName,
      metadata: { source: `${host}-cli`, ...m.kind ? { kind: m.kind } : {} },
      created_at: new Date(m.at).toISOString()
    };
  });
  for (let i = 0;i < messages.length; i += 100) {
    await honcho(cfg, `/sessions/${encodeURIComponent(sessionName2)}/messages`, {
      method: "POST",
      body: { messages: messages.slice(i, i + 100) }
    });
  }
  writeFileSync(qp, "");
  return messages.length;
}
// packages/core/src/cache.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { join as join3 } from "node:path";
var CACHE_TTL_MS = 10 * 60 * 1000;
var cacheDir = (host) => join3(honchoDir(), host, "cache");
function readCache(host, key) {
  try {
    const c = JSON.parse(readFileSync3(join3(cacheDir(host), `${fkey(key)}.json`), "utf8"));
    if (Date.now() - c.at > CACHE_TTL_MS)
      return null;
    return c;
  } catch {
    return null;
  }
}
function writeCache(host, key, ctx) {
  mkdirSync2(cacheDir(host), { recursive: true });
  writeFileSync2(join3(cacheDir(host), `${fkey(key)}.json`), JSON.stringify(ctx));
}
var markerPath = (host, key) => join3(cacheDir(host), `.injected-${fkey(key)}`);
function hasInjected(host, key) {
  return existsSync2(markerPath(host, key));
}
function markInjected(host, key) {
  mkdirSync2(cacheDir(host), { recursive: true });
  writeFileSync2(markerPath(host, key), String(Date.now()));
}
// packages/kimi-honcho/src/hook.ts
var HOST = "kimi";
var KIMI_HOME = process.env.KIMI_CODE_HOME || join4(homedir2(), ".kimi-code");
var verb = process.argv[2] || "status";
function cwdOf(p) {
  return p.cwd || process.cwd();
}
async function inject(p) {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled)
    return;
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
  if (block)
    console.log([block, DIRECTIVES, link].join(`
`));
}
async function prompt(p) {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled)
    return;
  const cwd = cwdOf(p);
  const key = p.session_id || sessionName(cfg, cwd, p.session_id);
  if (hasInjected(HOST, key))
    return;
  let ctx = readCache(HOST, key);
  if (!ctx) {
    try {
      ctx = await getPeerContext(cfg);
      writeCache(HOST, key, ctx);
    } catch {
      return;
    }
  }
  const block = renderPeerCard(ctx, cfg.peerName);
  if (block)
    console.log(`${block}
${DIRECTIVES}`);
  markInjected(HOST, key);
}
function findWire(sessionId) {
  if (!sessionId)
    return null;
  try {
    for (const line of readFileSync4(join4(KIMI_HOME, "session_index.jsonl"), "utf8").split(`
`)) {
      try {
        const j = JSON.parse(line);
        if (j.sessionId === sessionId && j.sessionDir) {
          const wire = join4(j.sessionDir, "agents", "main", "wire.jsonl");
          if (existsSync3(wire))
            return wire;
        }
      } catch {}
    }
  } catch {}
  const root = join4(KIMI_HOME, "sessions");
  try {
    for (const ws of readdirSync(root)) {
      const wire = join4(root, ws, sessionId, "agents", "main", "wire.jsonl");
      if (existsSync3(wire))
        return wire;
    }
  } catch {}
  return null;
}
function extractMessages(data) {
  const out = [];
  for (const line of data.split(`
`)) {
    if (!line)
      continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j.type !== "agent.message.appended")
      continue;
    const m = j.message?.message;
    if (!m || m.role !== "user" && m.role !== "assistant")
      continue;
    const text = textOf(m.content).trim();
    if (text)
      out.push({ role: m.role, text, at: j.time || Date.now() });
  }
  return out;
}
var msgHash = (m) => createHash("sha1").update(m.role + "\x00" + m.text).digest("hex");
function capture(key, wirePath) {
  let data;
  try {
    data = readFileSync4(wirePath, "utf8");
  } catch {
    return 0;
  }
  const size = Buffer.byteLength(data);
  const cur = readCursor(HOST, key);
  const from = cur.offset > 0 && cur.offset <= size ? cur.offset : 0;
  let pos = 0;
  let sliceStart = null;
  const lines = [];
  for (const line of data.split(`
`)) {
    const len = Buffer.byteLength(line) + 1;
    if (sliceStart === null && pos + len > from)
      sliceStart = pos;
    if (sliceStart !== null)
      lines.push(line);
    pos += len;
  }
  const fresh = extractMessages(lines.join(`
`));
  let skip = 0;
  const maxK = Math.min(fresh.length, cur.hashes.length, 1000);
  outer:
    for (let k = maxK;k > 0; k--) {
      for (let i = 0;i < k; i++) {
        if (msgHash(fresh[i]) !== cur.hashes[cur.hashes.length - k + i])
          continue outer;
      }
      skip = k;
      break;
    }
  const news = fresh.slice(skip);
  if (news.length)
    enqueue(HOST, key, news);
  writeCursor(HOST, key, {
    offset: size,
    hashes: cur.hashes.concat(news.map(msgHash)).slice(-1000)
  });
  return news.length;
}
async function writeback(p) {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled || !cfg.saveMessages)
    return;
  if (!p.session_id)
    return;
  const cwd = cwdOf(p);
  const name = sessionName(cfg, cwd, p.session_id);
  const key = p.session_id || name;
  const wire = findWire(p.session_id);
  if (wire)
    capture(key, wire);
  try {
    await flush(cfg, HOST, key, name);
  } catch {}
}
function status() {
  const cfg = loadConfig(HOST);
  if (!cfg) {
    console.log("no honcho config (set apiKey in ~/.honcho/config.json)");
    return;
  }
  const { apiKey, sessions, ...rest } = cfg;
  console.log("config:", JSON.stringify({ ...rest, apiKey: apiKey.slice(0, 8) + "…" }, null, 2));
  const dir = join4(honchoDir(), HOST, "queue");
  try {
    for (const f of readdirSync(dir).filter((f2) => f2.endsWith(".jsonl"))) {
      console.log(`queue ${f}: ${readFileSync4(join4(dir, f), "utf8").split(`
`).filter(Boolean).length} pending`);
    }
  } catch {
    console.log("queues: empty");
  }
}
try {
  const payload = await readPayload();
  if (verb === "recall")
    await inject(payload);
  else if (verb === "prompt")
    await prompt(payload);
  else if (verb === "writeback" || verb === "flush")
    await writeback(payload);
  else if (verb === "status")
    status();
} catch (e) {
  process.stderr.write(`honcho:${verb}: ${e?.message || e}
`);
}
process.exit(0);
