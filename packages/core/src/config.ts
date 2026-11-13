import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

export type SessionStrategy = "per-directory" | "git-branch" | "chat-instance";

export interface Config {
  apiKey: string;
  peerName: string;
  workspace: string;
  aiPeer: string;
  enabled: boolean;
  saveMessages: boolean;
  sessionStrategy: SessionStrategy;
  sessions: Record<string, string>;
  baseUrl: string;
}

const STORE = () => process.env.HONCHO_CONFIG_DIR || join(homedir(), ".honcho");

export function honchoDir(): string {
  return STORE();
}

// Resolution mirrors the official integrations: hosts.<host> block first,
// root fields as fallback, env vars on top. Never writes the file.
export function loadConfig(host: string): Config | null {
  let raw: any = {};
  try {
    raw = JSON.parse(readFileSync(join(STORE(), "config.json"), "utf8"));
  } catch {
    return null;
  }
  const hostBlock = raw.hosts?.[host] || {};
  const apiKey = process.env.HONCHO_API_KEY || hostBlock.apiKey || raw.apiKey;
  if (!apiKey) return null;

  const peerName =
    process.env.HONCHO_PEER_NAME || raw.peerName || process.env.USER || process.env.USERNAME || "user";
  const globalOverride = raw.globalOverride === true;
  const pick = <T,>(k: string, fb: T): T =>
    globalOverride ? raw[k] ?? fb : hostBlock[k] ?? raw[k] ?? fb;
  const endpoint = globalOverride ? raw.endpoint : hostBlock.endpoint ?? raw.endpoint;

  let baseUrl =
    endpoint?.baseUrl ||
    (endpoint?.environment === "local" ? "http://localhost:8000" : "https://api.honcho.dev");
  if (!baseUrl.endsWith("/v3")) baseUrl = baseUrl.replace(/\/+$/, "") + "/v3";

  return {
    apiKey,
    peerName,
    workspace: pick("workspace", host),
    aiPeer: pick("aiPeer", host),
    enabled: (hostBlock.enabled ?? raw.enabled) !== false,
    saveMessages: (hostBlock.saveMessages ?? raw.saveMessages) !== false,
    sessionStrategy: pick("sessionStrategy", "chat-instance"),
    sessions: raw.sessions || {},
    baseUrl,
  };
}

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
export const fkey = (k: string): string => slug(String(k)).slice(0, 80) || "default";

export function currentBranch(cwd: string): string | null {
  try {
    return (
      execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

export function repoName(cwd: string): string {
  try {
    const top = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (top) return slug(basename(top));
  } catch {}
  return slug(basename(cwd));
}

// Honcho session id. Default is per chat instance (claude-honcho model):
// every conversation writes to its own session, and recall is scoped/on-demand
// rather than a workspace-wide representation dump.
export function sessionName(cfg: Config, cwd: string, sessionId?: string): string {
  const override = cfg.sessions[cwd];
  if (override) return override;
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

export function honchoSessionUrl(workspace: string, session: string): string {
  return `https://app.honcho.dev/explore?workspace=${encodeURIComponent(
    workspace
  )}&view=sessions&session=${encodeURIComponent(session)}`;
}
