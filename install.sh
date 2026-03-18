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

cat <<'EOF'

Install complete.

To enable the plugin in OpenCode, add something like this to your opencode.json:

  {
    "plugins": [
      "./.config/opencode/plugins/opencode-memory/dist/opencode-plugin.js"
    ]
  }

You can then use the CLI helper in that directory:

  cd ~/.config/opencode/plugins/opencode-memory
  ./mem sessions
  ./mem dashboard 37777

EOF
