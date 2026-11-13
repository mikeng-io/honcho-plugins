---
name: honcho-memory
description: How Honcho persistent memory works in Kimi Code CLI — trust the injected peer card, recall on demand with scoped queries, inspect the queue. Use when the user asks about their memory, recall, or the Honcho integration.
---

# Honcho Memory in Kimi Code CLI

Memory is hook-based, not MCP-based. The `kimi-honcho` plugin registers five
lifecycle hooks that run the bundled `dist/hook.mjs`.

## What reaches your context

- At session start (or on the first user prompt as a fallback) a
  `<honcho-memory peer="...">` block with the user's **peer card** is injected:
  stable identity facts only. No representation dump — task-specific memory is
  recalled on demand so old tasks don't leak into new chats.
- Treat the peer card as ground truth about the user. Do not re-ask questions
  it answers.

## Recall on demand

When you need task-specific memory, run via Bash:

```sh
kimi-honcho query "what did we decide about X?"
kimi-honcho query "what was I working on in this repo?" --scope <repo-name>
kimi-honcho query "what did I do on this machine?" --scope <hostname>
```

- `--scope <name>` confines recall to one project's or machine's sessions
  (sessions join repo + hostname scopes automatically at session start).
- `--session <id>` confines recall to a single conversation.
- Prefer scoped queries over guessing or asking the user to repeat themselves.

## What gets captured

- Every user and assistant text turn is appended to a local JSONL queue and
  uploaded to Honcho at turn end (`Stop`), before compaction (`PreCompact`),
  and at `SessionEnd`.
- Capture is local-first: failed uploads stay queued and retry next turn.
  Tool calls and thinking blocks are not captured.

## Inspecting and debugging

- `kimi-honcho status` shows the resolved config and pending queue depth.
- Queues live at `~/.honcho/kimi/queue/<session>.jsonl`; context cache at
  `~/.honcho/kimi/cache/`.

## Configuration

All settings live in `~/.honcho/config.json`, shared with every other Honcho
integration. Kimi-specific settings go under `hosts.kimi`, falling back to
root fields:

- `workspace` — shared workspace name; same value on other hosts merges memory.
- `aiPeer` — the assistant's peer id (default `kimi`).
- `enabled`, `saveMessages` — kill switches (default true).
- `sessionStrategy` — `chat-instance` (default: one Honcho session per chat),
  `per-directory`, or `git-branch`.
- `endpoint.baseUrl` — self-hosted Honcho URL (with or without `/v3`).

Environment overrides: `HONCHO_API_KEY`, `HONCHO_PEER_NAME`, `HONCHO_CONFIG_DIR`.
