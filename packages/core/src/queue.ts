import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { honchoDir, fkey, type Config } from "./config.ts";
import { honcho } from "./honcho.ts";

export interface QueuedMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  kind?: string;
}

const queueDir = (host: string) => join(honchoDir(), host, "queue");
export const queuePath = (host: string, key: string) => join(queueDir(host), `${fkey(key)}.jsonl`);
export const cursorPath = (host: string, key: string) => join(queueDir(host), `${fkey(key)}.cursor.json`);

export function enqueue(host: string, key: string, entries: QueuedMessage[]): void {
  if (!entries.length) return;
  mkdirSync(queueDir(host), { recursive: true });
  appendFileSync(queuePath(host, key), entries.map((m) => JSON.stringify(m)).join("\n") + "\n");
}

export function readCursor(host: string, key: string): { offset: number; hashes: string[] } {
  try {
    const c = JSON.parse(readFileSync(cursorPath(host, key), "utf8"));
    return { offset: c.offset || 0, hashes: Array.isArray(c.hashes) ? c.hashes : [] };
  } catch {
    return { offset: 0, hashes: [] };
  }
}

export function writeCursor(host: string, key: string, cursor: { offset: number; hashes: string[] }): void {
  mkdirSync(queueDir(host), { recursive: true });
  writeFileSync(cursorPath(host, key), JSON.stringify(cursor));
}

// Upload everything queued for this conversation. On success the queue is
// cleared; on failure entries stay queued and retry next turn.
export async function flush(cfg: Config, host: string, key: string, sessionName: string): Promise<number> {
  const qp = queuePath(host, key);
  if (!existsSync(qp)) return 0;
  const pending = readFileSync(qp, "utf8").split("\n").filter(Boolean);
  if (!pending.length) return 0;
  const messages = pending.map((l) => {
    const m = JSON.parse(l) as QueuedMessage;
    return {
      content: m.text.slice(0, 25000),
      peer_id: m.role === "assistant" ? cfg.aiPeer : cfg.peerName,
      metadata: { source: `${host}-cli`, ...(m.kind ? { kind: m.kind } : {}) },
      created_at: new Date(m.at).toISOString(),
    };
  });
  for (let i = 0; i < messages.length; i += 100) {
    await honcho(cfg, `/sessions/${encodeURIComponent(sessionName)}/messages`, {
      method: "POST",
      body: { messages: messages.slice(i, i + 100) },
    });
  }
  writeFileSync(qp, "");
  return messages.length;
}

export function queueDepth(host: string, key: string): number {
  const qp = queuePath(host, key);
  if (!existsSync(qp)) return 0;
  return readFileSync(qp, "utf8").split("\n").filter(Boolean).length;
}
