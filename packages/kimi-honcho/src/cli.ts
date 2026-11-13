import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { loadConfig, recallChat } from "../../core/src/index.ts";
import { seedHostConfig } from "../../core/src/install.ts";

const HOST = "kimi";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "dist", "hook.mjs");
const KIMI_HOME = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
const [verb, ...args] = process.argv.slice(2);

function forward(v: string): never {
  const r = spawnSync(process.execPath, [HOOK, v], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

async function recall(args: string[]): Promise<void> {
  const query: string[] = [];
  let scope: string | undefined;
  let sessionId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scope") scope = args[++i];
    else if (args[i] === "--session") sessionId = args[++i];
    else query.push(args[i]);
  }
  if (!query.length) {
    console.error('Usage: kimi-honcho recall "your question" [--scope <repo|hostname>] [--session <id>]');
    process.exit(1);
  }
  const cfg = loadConfig(HOST);
  if (!cfg) throw new Error("no honcho config");
  console.log(await recallChat(cfg, query.join(" "), { scope, sessionId }));
}

switch (verb) {
  case "recall":
  case "prompt":
  case "writeback":
  case "flush":
  case "status":
    forward(verb);
    break;
  case "query":
    await recall(args);
    break;
  case "install": {
    const { workspace, path } = seedHostConfig(HOST);
    console.log(`hosts.kimi ready in ${path} (workspace=${workspace})`);
    const tomlPath = join(KIMI_HOME, "config.toml");
    if (existsSync(tomlPath)) {
      const toml = readFileSync(tomlPath, "utf8");
      const cleaned = toml.replace(/\n?# >>> honcho-kimi-hooks[\s\S]*?# <<< honcho-kimi-hooks <<<\n?/g, "\n");
      if (cleaned !== toml) {
        writeFileSync(tomlPath, cleaned);
        console.log("Removed legacy honcho-kimi-hooks block from config.toml");
      }
    }
    console.log(`\nIn Kimi Code CLI, run one of:\n\n  /plugins install ${ROOT}\n  /plugins install https://github.com/mikeng-io/honcho-plugins/releases/latest/download/kimi-honcho.zip\n\nThen /reload.`);
    break;
  }
  case "remove":
    console.log("In Kimi Code CLI, run:\n\n  /plugins remove kimi-honcho\n  /reload\n");
    console.log("Local queues at ~/.honcho/kimi/ are kept; delete them manually if unwanted.");
    break;
  default:
    console.log("Usage: kimi-honcho install | status | remove | recall | prompt | writeback | flush | query \"...\" [--scope x] [--session id]");
    process.exit(verb && verb !== "help" && verb !== "--help" ? 1 : 0);
}
