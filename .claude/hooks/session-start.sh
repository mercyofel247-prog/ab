#!/bin/bash
set -euo pipefail

# Remotion project deps (remotion-app/node_modules is gitignored, must be restored per session)
if [ -f "$CLAUDE_PROJECT_DIR/remotion-app/package.json" ]; then
  (cd "$CLAUDE_PROJECT_DIR/remotion-app" && npm install)
fi

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

# watch skill (/watch, video Q&A) setup. ffmpeg/ffprobe/yt-dlp are already
# ensured by the watchutube block above; this just scaffolds
# ~/.config/watch/.env and reports readiness -- idempotent and safe to run
# every session. Non-fatal: setup.py exits non-zero when a Whisper API key
# is still missing (frames-only fallback is fine), so a bare run shouldn't
# abort the rest of session start.
WATCH_SETUP="$CLAUDE_PROJECT_DIR/.claude/skills/watch/scripts/setup.py"
if [ -f "$WATCH_SETUP" ]; then
  python3 "$WATCH_SETUP" || true
fi
