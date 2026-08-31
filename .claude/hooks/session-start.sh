#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if [ -f requirements.txt ]; then
  pip install -r requirements.txt
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
