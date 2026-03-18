#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/troke12/opencode-memory.git"
TARGET_DIR="$HOME/.config/opencode/plugins/opencode-memory"

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

# Create a small shim in the global plugin directory so OpenCode's
# local plugin loader can find and load opencode-memory automatically
# without requiring changes to opencode.json.
PLUGIN_ROOT="$HOME/.config/opencode/plugins"
SHIM_PATH="$PLUGIN_ROOT/opencode-memory.js"

mkdir -p "$PLUGIN_ROOT"

cat >"$SHIM_PATH" <<'JS'
// Shim file so OpenCode can load the opencode-memory plugin
// from the global plugins directory.
module.exports = require("./opencode-memory/dist/opencode-plugin.js");
JS

echo "[opencode-memory] Wrote plugin shim: $SHIM_PATH"

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
