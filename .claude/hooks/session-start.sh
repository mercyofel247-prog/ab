#!/bin/bash
set -euo pipefail

# Remotion project deps (remotion-app/node_modules is gitignored, must be restored per session)
if [ -f "$CLAUDE_PROJECT_DIR/remotion-app/package.json" ]; then
  (cd "$CLAUDE_PROJECT_DIR/remotion-app" && npm install)
fi

# HyperFrames video-project deps (videos/*/node_modules is gitignored). Projects that
# pin the CLI locally ship a package-lock.json; restore them here so their `npm run`
# scripts use the fast local binary instead of re-downloading via npx at render time.
for pkg in "$CLAUDE_PROJECT_DIR"/videos/*/package.json; do
  [ -f "$pkg" ] || continue
  dir="$(dirname "$pkg")"
  if [ -f "$dir/package-lock.json" ]; then
    (cd "$dir" && npm install)
  fi
done

# ffmpeg/ffprobe (required by hyperframes for encoding/probing; not bundled)
if ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ffmpeg
fi

# HyperFrames CLI (used via `hyperframes ...` / npx by videos/*/package.json scripts)
npm install -g hyperframes@0.7.107

# Work around hyperframes shipping its CLI entry point without the executable bit set
HYPERFRAMES_BIN="$(npm root -g)/hyperframes/bin/hyperframes.mjs"
if [ -f "$HYPERFRAMES_BIN" ]; then
  chmod +x "$HYPERFRAMES_BIN"
fi

# Pre-fetch the Chrome the hyperframes renderer needs. Unlike Remotion (which is
# wired to the sandbox's pre-installed browser in remotion.config.ts), hyperframes
# resolves its own pinned chrome-headless-shell and downloads it (~114 MB) on the
# first render otherwise. Doing it here moves that cost into setup, keeps the first
# render instant, and preserves hyperframes' pinned-Chromium deterministic output.
# Non-fatal: on a network hiccup the renderer still falls back to an on-demand
# download, so a failed pre-fetch shouldn't abort the whole session.
hyperframes browser ensure || echo "warning: hyperframes browser pre-fetch failed; the first render will download Chrome on demand"
