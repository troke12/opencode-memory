# @troke12/opencode-memory

Persistent SQLite-backed memory plugin for [OpenCode](https://opencode.ai). Inspired by [claude-mem](https://github.com/thedotmack/claude-mem).

Captures tool calls, user prompts, and session summaries across OpenCode sessions — and makes them searchable so the AI can recall past context without re-reading files.

## Features

- **Auto-capture**: Records every tool call (read, write, bash, etc.) and user prompt automatically
- **Session summaries**: Generates a summary of files read/edited when a session closes
- **FTS search**: Full-text search across all past observations via `mem_search` tool
- **Memory notice**: Injects a lightweight notice into the system prompt so the AI knows memory is available
- **Web dashboard**: Browse sessions and observations at `http://localhost:48765`
- **Global DB**: All projects share one database at `~/.local/share/opencode-memory/memory.sqlite`

## Installation

### Option A — One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/troke12/opencode-memory/master/install.sh | bash
```

The script will:
1. Run `bun add @troke12/opencode-memory` inside `~/.config/opencode`
2. Add `"@troke12/opencode-memory"` to your `~/.config/opencode/opencode.json` automatically
3. Print confirmation when done

### Option B — Manual

```bash
cd ~/.config/opencode
bun add @troke12/opencode-memory
```

Then edit `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@troke12/opencode-memory"]
}
```

### Updating

```bash
cd ~/.config/opencode
bun add @troke12/opencode-memory@latest
```

### Restart OpenCode

After installation or update, restart OpenCode to load the new version.

## How it works

On each OpenCode session the plugin:

1. Creates a session record in SQLite
2. Captures every tool execution (`tool.execute.after`) and user prompt (`chat.message`) as observations
3. Injects a one-line memory notice into the system prompt once per session
4. On session close, writes a summary (files read/edited, tools used)

The AI can search past sessions using the built-in `mem_search` tool:

> *"Use mem_search to recall what files were edited in the last session"*

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_MEM_DB` | `~/.local/share/opencode-memory/memory.sqlite` | Custom DB path |
| `OPENCODE_MEM_DASHBOARD` | enabled | Set to `0` to disable dashboard |
| `OPENCODE_MEM_DASHBOARD_PORT` | `48765` | Dashboard port |
| `OPENCODE_MEM_DEBUG` | disabled | Set to `1` for debug logs |

## Dashboard

A local web UI is available while any session is open:

```
http://localhost:48765
```

It shows all sessions, observations, and a search interface. The server shuts down automatically when all sessions are closed.

## License

ISC
