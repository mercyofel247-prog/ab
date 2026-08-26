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

# watchutube skill deps (video analysis): opencv pinned to a 4.x release --
# the 5.x line dropped the classic CascadeClassifier API the skill's bundled
# face-detection cascade needs -- plus faster-whisper (voice-over
# transcription), librosa (music tempo/beat detection), pytesseract
# (on-screen-text OCR), and yt-dlp (URL downloads). Installed here, once per
# session, so the skill has zero install latency the first time it actually
# runs instead of lazily pip-installing mid-analysis. Each check is
# idempotent -- skip if already satisfied -- so a warm container is a no-op.
if ! python3 -c "import cv2; assert hasattr(cv2, 'CascadeClassifier')" >/dev/null 2>&1; then
  python3 -m pip install --quiet "opencv-python-headless==4.14.0.94"
fi
python3 -c "import faster_whisper" >/dev/null 2>&1 || python3 -m pip install --quiet faster-whisper
python3 -c "import librosa" >/dev/null 2>&1 || python3 -m pip install --quiet librosa
python3 -c "import pytesseract" >/dev/null 2>&1 || python3 -m pip install --quiet pytesseract
command -v yt-dlp >/dev/null 2>&1 || python3 -m pip install --quiet yt-dlp

# tesseract-ocr (system binary watchutube's OCR feature needs; not pip-installable).
# Non-fatal: OCR is one optional signal among many the skill produces.
if ! command -v tesseract >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq tesseract-ocr || echo "warning: tesseract-ocr install failed; watchutube's on-screen-text OCR won't be available this session"
fi

# Blender (headless 3D/render tool; not bundled in the sandbox). Script it with
# `blender --background --python <script.py>` — the apt build ships its own bundled
# Python, so a standalone `import bpy` from system python3 is not expected to work.
# Non-fatal: a failed install shouldn't abort the whole session.
if ! command -v blender >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq blender || echo "warning: blender install failed; 3D/blender renders won't be available this session"
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
