# Agent Guide for Opencode Memory Plugin

This repository contains the source code for the Opencode persistent memory plugin, a TypeScript-based CLI tool that manages session history and observations using SQLite.

## 1. Build, Lint, and Test Commands

### Build
The project uses TypeScript. To compile the source code to JavaScript:
```bash
npx tsc
```
This will output compiled files to the `dist/` directory (as configured in `tsconfig.json`).

### Run
To run the CLI directly during development:
```bash
npx ts-node src/index.ts <command>
# Example:
npx ts-node src/index.ts help
```

### Test
**Current Status:** There are currently no automated tests configured in `package.json`.
- **Recommendation:** If adding tests, use `jest` or `vitest`.
- **Manual Testing:** You can manually test by running the CLI commands:
  ```bash
  npx ts-node src/index.ts start-session test-project
  npx ts-node src/index.ts note "This is a test note"
  npx ts-node src/index.ts search "test"
  npx ts-node src/index.ts end-session
  ```

### Linting
**Current Status:** No linter is explicitly configured in `package.json`.
- **Style Enforced:** The code follows standard TypeScript conventions (see below).
- **Type Checking:** Run `npx tsc --noEmit` to check for type errors without generating files.

## 2. Code Style Guidelines

### Language & Syntax
- **Language:** TypeScript (Strict mode enabled in `tsconfig.json`).
- **Target:** ES2020 (CommonJS modules).
- **Indentation:** 2 spaces.
- **Quotes:** Single quotes `'` are preferred for strings.
- **Semicolons:** Always use semicolons at the end of statements.

### Naming Conventions
- **Variables & Functions:** `camelCase` (e.g., `activeSessionId`, `createSession`).
- **Classes:** `PascalCase` (e.g., `MemoryStore`).
- **Constants:** `SCREAMING_SNAKE_CASE` for global constants (e.g., `DB_PATH`, `SESSION_FILE`).
- **Files:** `kebab-case` or `camelCase` (current files are `index.ts`, `db.ts`).

### Imports
- Use ES6 `import` syntax.
- Import Node.js built-ins (like `fs`, `path`) directly.
- Import types where necessary.
```typescript
import fs from 'fs';
import { MemoryStore } from './db';
```

### Asynchronous Patterns
- **Async/Await:** Use `async/await` for all asynchronous operations. Avoid callback hell.
- **Promisify:** Use `util.promisify` for converting callback-based Node.js APIs (like `exec`) to promises.
```typescript
import { promisify } from 'util';
import { exec } from 'child_process';
const execAsync = promisify(exec);
```

### Error Handling
- Use `try/catch` blocks for operations that might fail (file I/O, database queries, command execution).
- Always ensure resources (like database connections) are closed in a `finally` block.
```typescript
try {
  await store.init();
  // ... operations
} catch (err) {
  console.error('Error:', err);
} finally {
  await store.close();
}
```

### Database Interaction
- Use the `MemoryStore` class in `src/db.ts` for all database interactions.
- **Library:** Uses `sqlite` wrapper around `sqlite3`.
- **Queries:** Raw SQL queries are used. Ensure parameters are parameterized (e.g., `?`) to prevent SQL injection.
```typescript
await this.db!.run('INSERT INTO sessions (project) VALUES (?)', project);
```

### CLI Implementation
- **Library:** Uses `yargs` for argument parsing.
- **Structure:** Define commands using `.command()`, providing builder and handler functions.
- **Output:** Use `console.log` for standard output and `console.error` for errors.

## 3. Architecture & Logic

- **Session Management:**
  - Active session ID is stored in a `.session` file in the current working directory.
  - `getActiveSessionId()` reads this file; `setActiveSessionId()` writes to it.
  - Always check for an active session before attempting to log observations.

- **Hooks:**
  - The tool supports hooks (`SessionStart`, `SessionEnd`, `UserPromptSubmit`) defined in `hooks/hooks.json`.
  - Hooks are handled via the `hook` command in `index.ts`.

- **Environment:**
  - `DB_PATH` defaults to `memory.sqlite` in the current working directory.
  - `process.cwd()` is used to resolve paths for the database and session file.

## 4. Agent Behavior Rules

When modifying this codebase:
1.  **Safety First:** Do not modify the database schema without verifying backward compatibility or providing a migration strategy (though currently, schema is created with `IF NOT EXISTS`).
2.  **Resource Management:** Always ensure the `MemoryStore` is closed after use.
3.  **Type Safety:** Do not use `any` unless absolutely necessary (e.g., handling complex external errors). Stick to defined interfaces and types.
4.  **Logging:** Keep CLI output clean and informative. Use `console.error` for actual errors.
