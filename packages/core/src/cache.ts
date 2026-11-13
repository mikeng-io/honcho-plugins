import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { honchoDir, fkey } from "./config.ts";
import type { PeerContext } from "./honcho.ts";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cacheDir = (host: string) => join(honchoDir(), host, "cache");

export function readCache(host: string, key: string): PeerContext | null {
  try {
    const c = JSON.parse(readFileSync(join(cacheDir(host), `${fkey(key)}.json`), "utf8"));
    if (Date.now() - c.at > CACHE_TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}

export function writeCache(host: string, key: string, ctx: PeerContext): void {
  mkdirSync(cacheDir(host), { recursive: true });
  writeFileSync(join(cacheDir(host), `${fkey(key)}.json`), JSON.stringify(ctx));
}

export const markerPath = (host: string, key: string) => join(cacheDir(host), `.injected-${fkey(key)}`);

export function hasInjected(host: string, key: string): boolean {
  return existsSync(markerPath(host, key));
}

export function markInjected(host: string, key: string): void {
  mkdirSync(cacheDir(host), { recursive: true });
  writeFileSync(markerPath(host, key), String(Date.now()));
}
