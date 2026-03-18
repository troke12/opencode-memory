#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
CONFIG_PATH="$CONFIG_DIR/opencode.json"
PLUGIN_ENTRY="@troke12/opencode-memory"

echo "[opencode-memory] Installing into $CONFIG_DIR..."

mkdir -p "$CONFIG_DIR"
cd "$CONFIG_DIR"

# Install the package using bun (preferred) or npm
if command -v bun &>/dev/null; then
  bun add "$PLUGIN_ENTRY"
else
  npm install "$PLUGIN_ENTRY"
fi

echo "[opencode-memory] Registering plugin in opencode.json..."

node <<NODE
const fs = require('fs');
const configPath = ${JSON.stringify("$CONFIG_PATH")};
const pluginEntry = "$PLUGIN_ENTRY";

let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8') || '{}');
  } catch (err) {
    console.error('[opencode-memory] Warning: could not parse opencode.json:', err.message);
    process.exit(1);
  }
}

if (!config.\$schema) config.\$schema = 'https://opencode.ai/config.json';

const plugins = Array.isArray(config.plugin) ? config.plugin : [];
if (!plugins.includes(pluginEntry)) {
  plugins.push(pluginEntry);
  config.plugin = plugins;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log('[opencode-memory] Added plugin entry to opencode.json');
} else {
  console.log('[opencode-memory] Plugin entry already present in opencode.json');
}
NODE

echo ""
echo "Install complete. Restart OpenCode to activate the plugin."
echo ""
echo "Memory DB: ~/.local/share/opencode-memory/memory.sqlite"
echo "Dashboard: http://localhost:48765 (while a session is open)"
echo ""
