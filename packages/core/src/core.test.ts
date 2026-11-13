import { describe, test, expect } from "bun:test";
import { slug, sessionName, type Config } from "./config.ts";
import { textOf } from "./stdin.ts";
import { renderPeerCard, renderRecentObservations } from "./render.ts";
import type { PeerContext } from "./honcho.ts";

const cfg = { sessionStrategy: "chat-instance", sessions: {} } as Config;

describe("sessionName", () => {
  test("chat-instance gives each conversation its own session", () => {
    expect(sessionName(cfg, "/work/repo", "session_abcd1234efgh")).toBe("repo-session_abcd");
    expect(sessionName(cfg, "/work/repo", "session_ffffffffffff")).not.toBe(
      sessionName(cfg, "/work/repo", "session_abcd1234efgh")
    );
  });
  test("per-directory keeps one session per project", () => {
    const c = { ...cfg, sessionStrategy: "per-directory" } as Config;
    expect(sessionName(c, "/work/My Repo")).toBe("my-repo");
  });
  test("explicit sessions[cwd] override wins", () => {
    const c = { ...cfg, sessions: { "/work/repo": "pinned" } } as Config;
    expect(sessionName(c, "/work/repo", "session_x")).toBe("pinned");
  });
});

describe("textOf", () => {
  test("plain string prompt", () => {
    expect(textOf("hello")).toBe("hello");
  });
  test("array-of-blocks prompt (real Kimi payload)", () => {
    expect(textOf([{ type: "text", text: "hello" }, { type: "think", think: "x" }])).toBe("hello");
  });
  test("non-text input is empty, never throws", () => {
    expect(textOf(undefined)).toBe("");
    expect(textOf(42)).toBe("");
  });
});

describe("renderPeerCard", () => {
  test("renders only the peer card, no representation", () => {
    const ctx: PeerContext = { representation: "old task stuff", peerCard: ["Name: Mike"], at: 0 };
    const out = renderPeerCard(ctx, "mike");
    expect(out).toContain("Profile: Name: Mike");
    expect(out).not.toContain("old task stuff");
  });
  test("empty peer card renders nothing", () => {
    expect(renderPeerCard({ representation: "x", peerCard: [], at: 0 }, "mike")).toBe("");
  });
});

describe("renderRecentObservations", () => {
  test("takes the LAST lines (most recent), skips headers", () => {
    const rep = "## Explicit Observations\nold fact\nmid fact\nnew fact";
    expect(renderRecentObservations(rep, 1)).toBe("- new fact");
    expect(renderRecentObservations(rep, 2)).toBe("- mid fact\n- new fact");
  });
});
