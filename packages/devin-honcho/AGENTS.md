# Honcho Memory

You have persistent cross-session memory via Honcho, captured through lifecycle
hooks (no MCP server involved). A `<honcho-memory>` block with the user's peer
card is injected at session start — trust it and act on it; do not ask the user
about things it already covers.

For anything task-specific — past decisions, project context, what happened
last week — recall on demand instead of guessing: run
`devin-honcho query "<question>"` via your shell tool (if that command is not
on PATH, use `node "$HOME/.honcho/devin/stage/cli.mjs" query "<question>"`).
Scope it with `--scope <repo-name>` to recall only this project's memory, or
`--scope <hostname>` for this machine. Sessions also join repo and hostname
scopes automatically, so scoped recall stays relevant.

User turns are captured to Honcho automatically at turn end and at session end,
and compaction summaries are captured after compaction, so preferences,
decisions, and project context persist across sessions and across other
Honcho-connected tools that share the same workspace and peer name.

If the user asks about their memory or the Honcho setup, the `honcho-memory`
skill explains the layout, the queue, and how to inspect it.
