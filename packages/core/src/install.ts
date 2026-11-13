import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { honchoDir } from "./config.ts";

// Seed hosts.<host> in ~/.honcho/config.json, preserving every existing block.
// Workspace and endpoint are inherited from the other integrations so all
// tools share one memory by default.
export function seedHostConfig(host: string): { workspace: string; path: string } {
  const path = join(honchoDir(), "config.json");
  let j: any = {};
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
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
      ...(j.hosts.codex?.endpoint ?? j.endpoint ? { endpoint: j.hosts.codex?.endpoint ?? j.endpoint } : {}),
      aiPeer: host,
      sessionStrategy: "chat-instance",
    };
    writeFileSync(path, JSON.stringify(j, null, 2) + "\n", { mode: 0o600 });
  }
  return { workspace: j.hosts[host].workspace, path };
}
