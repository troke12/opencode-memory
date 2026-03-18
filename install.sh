#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/troke12/opencode-memory.git"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_ROOT="$CONFIG_DIR/plugins"
TARGET_DIR="$PLUGIN_ROOT/opencode-memory"

echo "[opencode-memory] Installing to: $TARGET_DIR"

mkdir -p "$(dirname "$TARGET_DIR")"

if [ -d "$TARGET_DIR/.git" ]; then
  echo "[opencode-memory] Existing install found, pulling latest..."
  git -C "$TARGET_DIR" pull --ff-only || {
    echo "[opencode-memory] git pull failed; remove $TARGET_DIR and retry" >&2
    exit 1
  }
else
  rm -rf "$TARGET_DIR"
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

echo "[opencode-memory] Installing npm dependencies..."
npm install --omit=dev >/dev/null 2>&1 || npm install

echo "[opencode-memory] Building TypeScript..."
npx tsc

mkdir -p "$PLUGIN_ROOT"

# Create a small shim so OpenCode can load the plugin via a simple
# CommonJS module path from opencode.json.
SHIM_PATH="$PLUGIN_ROOT/opencode-memory.js"

cat >"$SHIM_PATH" <<'JS'
// Shim file so OpenCode can load the opencode-memory plugin
// from the global plugins directory.
module.exports = require("./opencode-memory/dist/opencode-plugin.js");
JS

echo "[opencode-memory] Wrote plugin shim: $SHIM_PATH"

# Ensure global OpenCode config exists and references the shim via the
# `plugin` array (see https://opencode.ai/config.json schema).
CONFIG_PATH="$CONFIG_DIR/opencode.json"

echo "[opencode-memory] Updating OpenCode config at: $CONFIG_PATH"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.HOME, '.config/opencode');
const configPath = path.join(configDir, 'opencode.json');
const pluginEntry = './plugins/opencode-memory.js';

let config = {};
if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8') || '{}';
    config = JSON.parse(raw);
  } catch (err) {
    console.error('[opencode-memory] Warning: could not parse existing opencode.json, leaving it unchanged. Error:', err.message);
    process.exit(0);
  }
}

if (!config.$schema) {
  config.$schema = 'https://opencode.ai/config.json';
}

const current = Array.isArray(config.plugin) ? config.plugin.slice() : [];
if (!current.includes(pluginEntry)) {
  current.push(pluginEntry);
}
config.plugin = current;

fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('[opencode-memory] Config updated to include plugin entry:', pluginEntry);
NODE

cat <<'EOF'

Install complete.

Global OpenCode config (~/.config/opencode/opencode.json) now references the opencode-memory plugin
when no previous config existed.

You can use the CLI helper in that directory:

  cd ~/.config/opencode/plugins/opencode-memory
  ./mem sessions
  ./mem dashboard 48765

Then start a new OpenCode session; the plugin should activate automatically.

EOF
