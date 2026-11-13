import {
  loadConfig, sessionName, honchoSessionUrl, textOf, readPayload,
  materialize, getPeerContext, renderPeerCard, DIRECTIVES,
  enqueue, flush,
  readCache, writeCache, hasInjected, markInjected,
} from "../../core/src/index.ts";

const HOST = "devin";
const verb = process.argv[2] || "status";

function cwdOf(p: any): string {
  return p.cwd || process.env.DEVIN_PROJECT_DIR || process.cwd();
}

// Devin injects context through this JSON envelope on stdout.
function emitContext(eventName: string, text: string): void {
  if (!text) return;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }));
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
  if (block) emitContext("SessionStart", [block, DIRECTIVES, link].join("\n"));
}

// Capture the user's turn locally; if SessionStart did not inject (older
// builds), inject the peer card once here as a fallback.
async function prompt(p: any): Promise<void> {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled) return;
  const cwd = cwdOf(p);
  const key = p.session_id || sessionName(cfg, cwd, p.session_id);
  const promptText = textOf(p.prompt).trim();

  if (cfg.saveMessages && promptText) {
    enqueue(HOST, key, [{ role: "user", text: promptText, at: Date.now() }]);
  }

  if (hasInjected(HOST, key)) return;
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
  if (block) emitContext("UserPromptSubmit", `${block}\n${DIRECTIVES}`);
  markInjected(HOST, key);
}

async function flushQueue(p: any): Promise<void> {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled || !cfg.saveMessages) return;
  const cwd = cwdOf(p);
  const name = sessionName(cfg, cwd, p.session_id);
  const key = p.session_id || name;
  try {
    await flush(cfg, HOST, key, name);
  } catch {}
}

// PostCompaction: the compaction summary is valuable memory material —
// Devin exposes no transcript, so this is the assistant-side capture.
async function compact(p: any): Promise<void> {
  const cfg = loadConfig(HOST);
  if (!cfg || !cfg.enabled) return;
  const cwd = cwdOf(p);
  const name = sessionName(cfg, cwd, p.session_id);
  const key = p.session_id || name;
  const summary = (p.summary || "").trim();
  if (cfg.saveMessages && summary) {
    enqueue(HOST, key, [{ role: "assistant", text: summary, at: Date.now(), kind: "compaction-summary" }]);
  }
  try {
    await flush(cfg, HOST, key, name);
  } catch {}
}

function status(): void {
  const cfg = loadConfig(HOST);
  if (!cfg) {
    console.log("no honcho config (set apiKey in ~/.honcho/config.json)");
    return;
  }
  const { apiKey, sessions, ...rest } = cfg;
  console.log("config:", JSON.stringify({ ...rest, apiKey: apiKey.slice(0, 8) + "…" }, null, 2));
}

try {
  const payload = await readPayload();
  if (verb === "recall") await inject(payload);
  else if (verb === "prompt") await prompt(payload);
  else if (verb === "flush") await flushQueue(payload);
  else if (verb === "compact") await compact(payload);
  else if (verb === "status") status();
} catch (e: any) {
  process.stderr.write(`honcho:${verb}: ${e?.message || e}\n`);
}
process.exit(0);
