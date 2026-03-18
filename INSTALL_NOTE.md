# Opencode Memory Plugin (Simulated Installation)

I have "installed" the `opencode-mem` plugin by:

1.  **Global Command**: `mem` is available in your PATH.
2.  **Plugin Directory**: Copied to `~/.opencode/plugins/marketplaces/opencode/opencode-mem` (speculative location).
3.  **Hooks**: Defined in `hooks/hooks.json` within the plugin directory.

## Automatic Hook Triggering

If Opencode supports hooks similar to Claude Code, it should automatically trigger `mem hook SessionStart` etc. based on the configuration.

If not, you can manually trigger them or use `mem start-session <project>` and `mem run <command>`.

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
