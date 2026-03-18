# Persistent Opencode Memory Plugin

A lightweight, persistent memory tool for Opencode (and other CLI agents) inspired by [claude-mem](https://github.com/thedotmack/claude-mem).

This tool allows you to track your sessions, commands, and notes, and recall them later. It is designed to be used by the agent itself to maintain context across sessions.

## Features

-   **Session Management**: Organize work into sessions per project.
-   **Automatic Logging**: Execute commands via `mem run` to automatically log output.
-   **Notes**: Record thoughts, plans, and observations.
-   **Search**: Retrieve past context using keyword search.
-   **Persistence**: All data is stored in a local SQLite database (`memory.sqlite`).

## Installation

1.  Clone this repository.
2.  Run `npm install`.
3.  Use the `./mem` script.

## Usage

### 1. Start a Session

Start a new session for a specific project. This creates a `.session` file to track the active session ID.

```bash
./mem start-session my-project
```

### 2. Run Commands

Execute shell commands and automatically log the command, output, and exit code to the active session.

```bash
./mem run ls -F
./mem run npm test
```

### 3. Log Notes

Record your thoughts, observations, or plans.

```bash
./mem note "The tests failed because of a missing dependency."
./mem note "Plan: Install dependency and retry."
```

### 4. Search Memory

Retrieve past observations, commands, and notes. Matches against content and project names.

```bash
./mem search "dependency"
./mem search "ls"
```

### 5. Check Status

See the current active session ID.

```bash
./mem status
```

### 6. End Session

End the current session, optionally providing a summary.

```bash
./mem end-session "Fixed the dependency issue and tests passed."
```

## Database Schema

The data is stored in `memory.sqlite` with the following schema:

-   **sessions**: `id`, `project`, `started_at`, `ended_at`, `summary`
-   **observations**: `id`, `session_id`, `type` (command, note), `content`, `metadata` (JSON), `created_at`

## License

ISC
