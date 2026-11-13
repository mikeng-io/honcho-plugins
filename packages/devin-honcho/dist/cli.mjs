// packages/devin-honcho/src/cli.ts
import { mkdirSync, copyFileSync } from "node:fs";
import { join as join3, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// packages/core/src/config.ts
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
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
// packages/core/src/honcho.ts
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
async function recallChat(cfg, query, opts = {}) {
  const body = { query, reasoning_level: opts.reasoningLevel ?? "low" };
  if (opts.sessionId)
    body.session_id = opts.sessionId;
  else if (opts.scope)
    body.scope = opts.scope;
  const res = await honcho(cfg, `/peers/${encodeURIComponent(cfg.peerName)}/chat`, {
    method: "POST",
    body,
    timeoutMs: 60000
  });
  return res?.content ?? "";
}
// packages/core/src/render.ts
var DIRECTIVES = "This is persistent cross-session memory about the user, maintained automatically " + "by Honcho. Trust it and act on it — do not ask the user about things it already covers. " + "For anything task-specific, recall on demand with the host's recall command " + "(see the honcho-memory skill) instead of guessing.";
// packages/core/src/cache.ts
var CACHE_TTL_MS = 10 * 60 * 1000;
// packages/core/src/install.ts
import { readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
function seedHostConfig(host) {
  const path = join2(honchoDir(), "config.json");
  let j = {};
  try {
    j = JSON.parse(readFileSync2(path, "utf8"));
  } catch {}
  const key = process.env.HONCHO_API_KEY || j.apiKey || j.hosts?.[host]?.apiKey;
  if (!key) {
    throw new Error("No Honcho API key found. Run `honcho init` (uv tool install honcho-cli) first.");
  }
  j.hosts = j.hosts || {};
  if (!j.hosts[host]) {
    j.hosts[host] = {
      workspace: j.hosts.codex?.workspace ?? j.hosts.claude_code?.workspace ?? j.workspace ?? host,
      enabled: true,
      saveMessages: true,
      reasoningLevel: "low",
      ...j.hosts.codex?.endpoint ?? j.endpoint ? { endpoint: j.hosts.codex?.endpoint ?? j.endpoint } : {},
      aiPeer: host,
      sessionStrategy: "chat-instance"
    };
    writeFileSync(path, JSON.stringify(j, null, 2) + `
`, { mode: 384 });
  }
  return { workspace: j.hosts[host].workspace, path };
}

// packages/devin-honcho/src/cli.ts
var HOST = "devin";
var ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
var HOOK = join3(ROOT, "dist", "hook.mjs");
var [verb, ...args] = process.argv.slice(2);
function forward(v) {
  const r = spawnSync(process.execPath, [HOOK, v], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
async function recall(args2) {
  const query = [];
  let scope;
  let sessionId;
  for (let i = 0;i < args2.length; i++) {
    if (args2[i] === "--scope")
      scope = args2[++i];
    else if (args2[i] === "--session")
      sessionId = args2[++i];
    else
      query.push(args2[i]);
  }
  if (!query.length) {
    console.error('Usage: devin-honcho query "your question" [--scope <repo|hostname>] [--session <id>]');
    process.exit(1);
  }
  const cfg = loadConfig(HOST);
  if (!cfg)
    throw new Error("no honcho config");
  console.log(await recallChat(cfg, query.join(" "), { scope, sessionId }));
}
switch (verb) {
  case "recall":
  case "prompt":
  case "flush":
  case "compact":
  case "status":
    forward(verb);
    break;
  case "query":
    await recall(args);
    break;
  case "install": {
    const { workspace, path } = seedHostConfig(HOST);
    console.log(`hosts.devin ready in ${path} (workspace=${workspace})`);
    const stage = join3(honchoDir(), "devin", "stage");
    mkdirSync(stage, { recursive: true });
    copyFileSync(HOOK, join3(stage, "hook.mjs"));
    copyFileSync(join3(ROOT, "dist", "cli.mjs"), join3(stage, "cli.mjs"));
    console.log(`Staged hooks at ${join3(stage, "hook.mjs")}`);
    console.log(`
Install the plugin:

  devin plugins install mikeng-io/honcho-plugins#packages/devin-honcho

or from this checkout:

  devin plugins install --local ${ROOT}
`);
    break;
  }
  case "remove":
    console.log(`Run:

  devin plugins remove devin-honcho
`);
    console.log("Local queues at ~/.honcho/devin/ are kept; delete them manually if unwanted.");
    break;
  default:
    console.log('Usage: devin-honcho install | status | remove | recall | prompt | flush | compact | query "..." [--scope x] [--session id]');
    process.exit(verb && verb !== "help" && verb !== "--help" ? 1 : 0);
}
