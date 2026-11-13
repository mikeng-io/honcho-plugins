# honcho-plugins

Persistent cross-session memory for coding-agent CLIs, built on [Honcho](https://honcho.dev).

> **Unofficial community plugins** by [mikeng-io](https://github.com/mikeng-io) — not affiliated with or endorsed by Plastic Labs (the makers of Honcho). Modeled on the official [claude-honcho](https://github.com/plastic-labs/claude-honcho) architecture.

Monorepo with a shared TypeScript core and thin per-host adapters. Hooks capture every turn to a local-first queue; recall is peer-card injection at session start plus **scoped on-demand queries** — no MCP server anywhere.

## Packages

| Package | Host | Install |
| - | - | - |
| `packages/kimi-honcho` | Kimi Code CLI | `/plugins install https://github.com/mikeng-io/honcho-plugins/releases/latest/download/kimi-honcho.zip` then `/reload` |
| `packages/devin-honcho` | Devin CLI | `npx -p github:mikeng-io/honcho-plugins devin-honcho install` then `devin plugins install mikeng-io/honcho-plugins#packages/devin-honcho` |

Both need Node >= 18 and a Honcho key in `~/.honcho/config.json` (`honcho init`, or reuse an existing config from claude-honcho / codex-honcho). Self-hosted Honcho: set `endpoint.baseUrl`.

## Architecture

```
SessionStart  →  materialize session + join repo & hostname scopes, inject peer card
UserPrompt    →  capture turn to local JSONL queue (fallback injection if needed)
Stop/Compact  →  upload queue to Honcho (failed uploads stay queued)
On demand     →  <host>-honcho query "..." [--scope repo|hostname] [--session id]
```

- **Per-chat sessions** (default `chat-instance`): every conversation writes to its own Honcho session, so old task memory never bleeds into new chats.
- **Lean injection**: peer card only. No workspace-wide representation dumps.
- **Scoped recall**: `query` hits Honcho's dialectic `chat` endpoint with scope/session filters, so the agent pulls exactly the memory it needs, when it needs it.

## Development

Requires [Bun](https://bun.sh) for the toolchain; runtime is plain Node.

```sh
bun install
bun run build   # tsc typecheck + single-file zero-dep .mjs bundles per host
bun test        # core unit tests
```

```
packages/core/          config · honcho REST client · queue · cache · render · recall
packages/kimi-honcho/   kimi.plugin.json · adapter (wire.jsonl capture) · cli
packages/devin-honcho/  .devin-plugin/ · hooks.json · adapter · cli
```

## License

MIT — see LICENSE. Portions adapted from plastic-labs/codex-honcho (MIT).
