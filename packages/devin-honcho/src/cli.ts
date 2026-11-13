import { mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig, recallChat, honchoDir } from "../../core/src/index.ts";
import { seedHostConfig } from "../../core/src/install.ts";

const HOST = "devin";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "dist", "hook.mjs");
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
    console.error('Usage: devin-honcho query "your question" [--scope <repo|hostname>] [--session <id>]');
    process.exit(1);
  }
  const cfg = loadConfig(HOST);
  if (!cfg) throw new Error("no honcho config");
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
    // Stage the compiled bundle; hooks.json references it via portable ~/ paths
    // (Devin does not resolve ./ hook commands against the plugin root).
    const stage = join(honchoDir(), "devin", "stage");
    mkdirSync(stage, { recursive: true });
    copyFileSync(HOOK, join(stage, "hook.mjs"));
    copyFileSync(join(ROOT, "dist", "cli.mjs"), join(stage, "cli.mjs"));
    console.log(`Staged hooks at ${join(stage, "hook.mjs")}`);
    console.log(`\nInstall the plugin:\n\n  devin plugins install mikeng-io/honcho-plugins#packages/devin-honcho\n\nor from this checkout:\n\n  devin plugins install --local ${ROOT}\n`);
    break;
  }
  case "remove":
    console.log("Run:\n\n  devin plugins remove devin-honcho\n");
    console.log("Local queues at ~/.honcho/devin/ are kept; delete them manually if unwanted.");
    break;
  default:
    console.log("Usage: devin-honcho install | status | remove | recall | prompt | flush | compact | query \"...\" [--scope x] [--session id]");
    process.exit(verb && verb !== "help" && verb !== "--help" ? 1 : 0);
}
