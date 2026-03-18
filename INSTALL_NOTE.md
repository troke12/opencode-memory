# Opencode Memory Plugin (Simulated Installation)

This repository provides the `opencode-mem` plugin and a companion `mem` CLI.

1.  **Global Command**: `mem` is available in your PATH.
2.  **Plugin Module**: The OpenCode plugin entry point is `src/opencode-plugin.ts` (exporting `OpenCodeMemPlugin`).

The plugin is designed to be enabled via OpenCode's native plugin system as described in:
https://dev.to/einarcesar/does-opencode-support-hooks-a-complete-guide-to-extensibility-k3p

You can still use the CLI directly in any project directory.

## Next Session Test

In the next session, try:

```bash
mem status
mem start-session my-project
mem run ls
mem search "ls"
```

If the environment persists `/usr/bin/mem` and `~/.opencode`, it will work.
If not, you might need to re-run the setup script or use the repository directly.
