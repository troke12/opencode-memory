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

CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"

echo "[opencode-memory] Ensuring global opencode.json has plugin entry..."
mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
  # If file exists but does not mention opencode-memory, append a hint for the user.
  if ! grep -q "opencode-memory" "$CONFIG_FILE"; then
    echo "[opencode-memory] NOTE: Existing opencode.json detected."
    echo "[opencode-memory] Please add this plugin definition under the \"plugins\" object (see OpenCode docs):"
    echo "  \"plugins\": {"
    echo "    \"opencode-memory\": {"
    echo "      \"enabled\": true,"
    echo "      \"module\": \"./plugins/opencode-memory/dist/opencode-plugin.js\""
    echo "    }"
    echo "  }"
  fi
else
  cat >"$CONFIG_FILE" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": {
    "opencode-memory": {
      "enabled": true,
      "module": "./plugins/opencode-memory/dist/opencode-plugin.js"
    }
  }
}
JSON
  echo "[opencode-memory] Created global opencode.json with opencode-memory plugin enabled."
fi

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
