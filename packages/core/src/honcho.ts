import { hostname } from "node:os";
import type { Config } from "./config.ts";
import { repoName } from "./config.ts";

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
}

export async function honcho(cfg: Config, path: string, opts: RequestOptions = {}): Promise<any> {
  const { method = "GET", body, query, timeoutMs = 8000 } = opts;
  const url = new URL(`${cfg.baseUrl}/workspaces/${encodeURIComponent(cfg.workspace)}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${method} ${url.pathname} → HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export interface PeerContext {
  representation: string | null;
  peerCard: string[] | null;
  at: number;
}

export async function getPeerContext(cfg: Config, maxConclusions = 8): Promise<PeerContext> {
  const c = await honcho(cfg, `/peers/${encodeURIComponent(cfg.peerName)}/context`, {
    query: { max_conclusions: maxConclusions, include_most_frequent: true },
  });
  return { representation: c?.representation ?? null, peerCard: c?.peer_card ?? null, at: Date.now() };
}

// Materialize peers + session and join it to the repo and hostname scopes,
// so on-demand recall can be confined to this project or this machine.
export async function materialize(cfg: Config, name: string, cwd: string): Promise<void> {
  await Promise.all([
    honcho(cfg, "/peers", { method: "POST", body: { id: cfg.peerName } }),
    honcho(cfg, "/peers", { method: "POST", body: { id: cfg.aiPeer } }),
    honcho(cfg, "/sessions", { method: "POST", body: { id: name } }),
  ]);
  await honcho(cfg, `/sessions/${encodeURIComponent(name)}/peers`, {
    method: "POST",
    body: { [cfg.peerName]: {}, [cfg.aiPeer]: {} },
  });
  const scopes = [repoName(cwd), hostname()].filter(Boolean);
  for (const scope of scopes) {
    try {
      await honcho(cfg, "/scopes", { method: "POST", body: { id: scope } });
      await honcho(cfg, `/scopes/${encodeURIComponent(scope)}/sessions`, {
        method: "POST",
        body: { session_ids: [name] },
      });
    } catch {
      // scopes are best-effort: older/self-hosted servers may not support them
    }
  }
}

export interface RecallOptions {
  scope?: string;
  sessionId?: string;
  reasoningLevel?: "minimal" | "low" | "medium" | "high" | "max";
}

// On-demand scoped recall — the "pull" half of the architecture. The agent
// calls this through the per-host CLI when it needs memory mid-task.
export async function recallChat(cfg: Config, query: string, opts: RecallOptions = {}): Promise<string> {
  const body: Record<string, unknown> = { query, reasoning_level: opts.reasoningLevel ?? "low" };
  if (opts.sessionId) body.session_id = opts.sessionId;
  else if (opts.scope) body.scope = opts.scope;
  const res = await honcho(cfg, `/peers/${encodeURIComponent(cfg.peerName)}/chat`, {
    method: "POST",
    body,
    timeoutMs: 60000,
  });
  return res?.content ?? "";
}
