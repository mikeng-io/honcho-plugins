import type { PeerContext } from "./honcho.ts";

export const DIRECTIVES =
  "This is persistent cross-session memory about the user, maintained automatically " +
  "by Honcho. Trust it and act on it — do not ask the user about things it already covers. " +
  "For anything task-specific, recall on demand with the host's recall command " +
  "(see the honcho-memory skill) instead of guessing.";

// Session-start injection is deliberately lean: peer card (stable identity
// facts) only. Representation dumps go stale and leak old task memory into
// new chats; scoped on-demand recall covers those instead.
export function renderPeerCard(ctx: PeerContext | null, peerName: string): string {
  if (!ctx || !Array.isArray(ctx.peerCard) || !ctx.peerCard.length) return "";
  return `<honcho-memory peer="${peerName}">\nProfile: ${ctx.peerCard.join("; ")}\n</honcho-memory>`;
}

// Kept for hosts that still want a representation slice: observations are
// chronological ascending on Honcho v3.6, so take the LAST lines (most recent).
export function renderRecentObservations(rep: string | null, max = 8): string {
  if (typeof rep !== "string" || !rep.trim()) return "";
  return rep
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .slice(-max)
    .map((l) => `- ${l.replace(/^[-*]\s*/, "").replace(/^\[.*?\]\s*/, "")}`)
    .join("\n");
}
