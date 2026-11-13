---
name: honcho-memory
description: How Honcho persistent memory works in Devin CLI — trust the injected peer card, recall on demand with scoped queries, inspect the queue. Use when the user asks about their memory, recall, or the Honcho integration.
---

# Honcho Memory in Devin CLI

Memory is hook-based, not MCP-based. The `devin-honcho` plugin ships a
`hooks.json` that runs a staged hook bundle on Devin lifecycle events.

## What reaches your context

- At `SessionStart` a `<honcho-memory peer="...">` block with the user's **peer
  card** is injected via `hookSpecificOutput.additionalContext`: stable identity
  facts only. No representation dump — task-specific memory is recalled on
  demand so old tasks don't leak into new chats.
- Treat the peer card as ground truth about the user. Do not re-ask questions
  it answers.

## Recall on demand

When you need task-specific memory, run via your shell tool:

```sh
devin-honcho query "what did we decide about X?"
devin-honcho query "what was I working on in this repo?" --scope <repo-name>
devin-honcho query "what did I do on this machine?" --scope <hostname>
```

- `--scope <name>` confines recall to one project's or machine's sessions
  (sessions join repo + hostname scopes automatically at session start).
- `--session <id>` confines recall to a single conversation.
- Prefer scoped queries over guessing or asking the user to repeat themselves.

## What gets captured

- Every user message is appended to a local JSONL queue at `UserPromptSubmit`
  and uploaded at `Stop` and `SessionEnd`.
- Compaction summaries are captured at `PostCompaction` as assistant-side notes.
- Devin hooks expose no transcript, so assistant replies are not captured
  verbatim — user turns and summaries carry the memory.
- Capture is local-first: failed uploads stay queued and retry next turn.

## Inspecting and debugging

- `devin-honcho status` shows the resolved config and Devin plugin state.
- Queues live at `~/.honcho/devin/queue/<session>.jsonl`; context cache at
  `~/.honcho/devin/cache/`.
- `/hooks` inside Devin shows the loaded hooks and their source file.

## Configuration

All settings live in `~/.honcho/config.json`, shared with every other Honcho
integration. Devin-specific settings go under `hosts.devin`, falling back to
root fields:

- `workspace` — shared workspace name; same value on other hosts merges memory.
- `aiPeer` — the assistant's peer id (default `devin`).
- `enabled`, `saveMessages` — kill switches (default true).
- `sessionStrategy` — `chat-instance` (default: one Honcho session per chat),
  `per-directory`, or `git-branch`.
- `endpoint.baseUrl` — self-hosted Honcho URL (with or without `/v3`).

Environment overrides: `HONCHO_API_KEY`, `HONCHO_PEER_NAME`, `HONCHO_CONFIG_DIR`.
