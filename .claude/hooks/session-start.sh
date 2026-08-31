#!/bin/bash
set -euo pipefail

# Disable hyperframes' own background auto-updater for the whole session, not
# just this script. hyperframes ships a self-update mechanism
# (src/utils/autoUpdate.ts, `scheduleBackgroundInstall`) that any `hyperframes`
# invocation can trigger: it spawns a fully DETACHED, unref'd child process
# that runs `npm install -g hyperframes@latest` in the background, outside
# this (or any) script's process tree entirely -- so no amount of locking
# inside this hook can stop it. It treats a 0.7.x -> 0.8.x bump as a minor
# version (0.x semver has no real "major"), so it silently overwrote the
# pinned global install below within seconds of any `hyperframes` call
# (confirmed by checkpointing `hyperframes --version` through a run, and by
# reading the shipped source directly). `HYPERFRAMES_NO_AUTO_INSTALL=1` is
# the library's own documented escape hatch for this. Writing it to
# /etc/profile.d/ (regenerated fresh each session, same as this whole
# container -- see e.g. ccr-agent-proxy-ca.sh alongside it) makes it apply to
# every shell for the rest of the session, not just this script's own
# process, since the updater can just as easily fire from a project's
# `npm run render` or a later `hyperframes doctor` as from here.
cat > /etc/profile.d/hyperframes-no-autoupdate.sh <<'EOF'
export HYPERFRAMES_NO_AUTO_INSTALL=1
export HYPERFRAMES_NO_UPDATE_CHECK=1
EOF
export HYPERFRAMES_NO_AUTO_INSTALL=1
export HYPERFRAMES_NO_UPDATE_CHECK=1

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

# HyperFrames CLI (used via `hyperframes ...` / npx by videos/*/package.json scripts),
# pinned to an exact version for deterministic renders (mirrors each video
# project's own local devDependency pin), plus the Chrome pre-fetch below.
#
# This whole block is guarded two ways:
#   1. Skip the reinstall if the pin is already satisfied -- like every other
#      check in this file, so a warm session is a fast no-op instead of an
#      unconditional `npm install -g` on every single firing.
#   2. flock serializes the block across overlapping hook firings (this hook
#      can fire more than once in close succession -- e.g. overlapping resume
#      events -- in this environment). An earlier unpinned/unconditional
#      version of this block raced with itself under exactly that overlap and
#      intermittently corrupted the global install (hyperframes.mjs missing,
#      package.json left on the wrong version, `hyperframes` briefly
#      "command not found") -- reproduced and confirmed by checkpointing
#      `hyperframes --version` through a full run. The lock plus the
#      already-pinned fast-path together close that race.
(
  flock -w 120 200 || exit 0
  if [ "$(hyperframes --version 2>/dev/null || true)" != "0.7.107" ]; then
    npm install -g hyperframes@0.7.107

    # Work around hyperframes shipping its CLI entry point without the executable bit set
    HYPERFRAMES_BIN="$(npm root -g)/hyperframes/bin/hyperframes.mjs"
    if [ -f "$HYPERFRAMES_BIN" ]; then
      chmod +x "$HYPERFRAMES_BIN"
    fi
  fi

  # Pre-fetch the Chrome the hyperframes renderer needs. Unlike Remotion (which is
  # wired to the sandbox's pre-installed browser in remotion.config.ts), hyperframes
  # resolves its own pinned chrome-headless-shell and downloads it (~114 MB) on the
  # first render otherwise. Doing it here moves that cost into setup, keeps the first
  # render instant, and preserves hyperframes' pinned-Chromium deterministic output.
  # Non-fatal: on a network hiccup the renderer still falls back to an on-demand
  # download, so a failed pre-fetch shouldn't abort the whole session.
  hyperframes browser ensure || echo "warning: hyperframes browser pre-fetch failed; the first render will download Chrome on demand"
) 200>/tmp/hyperframes-global-cli.lock

# Optional local-fallback tooling for hyperframes' transcription/TTS/BGM
# features (surfaced by `hyperframes doctor`) and the Docker daemon (for
# `hyperframes render --docker`'s bit-deterministic mode). None of this is
# required by any video project's default render path -- installed here so
# it's ready session to session instead of installing on first use. Every
# check is idempotent (skip if already satisfied) and non-fatal.

# whisper-cpp: hyperframes looks for a `whisper-cli` binary on PATH. No apt
# package ships it; build from source (needs cmake + a C/C++ compiler).
if ! command -v whisper-cli >/dev/null 2>&1; then
  if ! command -v cmake >/dev/null 2>&1 || ! command -v gcc >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq cmake build-essential || true
  fi
  if command -v cmake >/dev/null 2>&1 && command -v gcc >/dev/null 2>&1; then
    WHISPER_SRC="$(mktemp -d)"
    if git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_SRC" >/dev/null 2>&1 \
      && cmake -B "$WHISPER_SRC/build" -DCMAKE_BUILD_TYPE=Release "$WHISPER_SRC" >/dev/null 2>&1 \
      && cmake --build "$WHISPER_SRC/build" --config Release -j"$(nproc)" >/dev/null 2>&1 \
      && [ -f "$WHISPER_SRC/build/bin/whisper-cli" ]; then
      cp "$WHISPER_SRC/build/bin/whisper-cli" /usr/local/bin/whisper-cli
      cp "$WHISPER_SRC"/build/bin/libwhisper.so* /usr/local/lib/ 2>/dev/null || true
      chmod +x /usr/local/bin/whisper-cli
      ldconfig 2>/dev/null || true
    else
      echo "warning: whisper-cpp build failed; hyperframes' local transcription/captions won't be available this session"
    fi
    rm -rf "$WHISPER_SRC"
  else
    echo "warning: cmake/build-essential unavailable; skipping whisper-cpp build"
  fi
fi

# Kokoro TTS (hyperframes' local voice-over fallback)
python3 -c "import kokoro_onnx" >/dev/null 2>&1 || python3 -m pip install --quiet kokoro-onnx soundfile

# MusicGen (hyperframes' local background-music fallback). Try the smaller
# CPU-only torch wheel first; some egress policies block download.pytorch.org,
# so fall back to the default PyPI index (a larger CUDA-inclusive wheel that
# still runs fine on CPU) if that host is unreachable.
python3 -c "import torch" >/dev/null 2>&1 || \
  python3 -m pip install --quiet --index-url https://download.pytorch.org/whl/cpu torch 2>/dev/null || \
  python3 -m pip install --quiet torch
python3 -c "import transformers" >/dev/null 2>&1 || python3 -m pip install --quiet transformers
python3 -c "import soundfile" >/dev/null 2>&1 || python3 -m pip install --quiet soundfile
python3 -c "import numpy" >/dev/null 2>&1 || python3 -m pip install --quiet numpy

# Docker daemon (only needed for `hyperframes render --docker`'s
# bit-deterministic mode; no project's default render path uses it). This
# sandbox has no systemd, so the usual init script (which tries to raise
# ulimits the container doesn't permit) fails -- start dockerd directly.
if ! docker ps >/dev/null 2>&1; then
  service docker start >/dev/null 2>&1 || true
  sleep 1
  if ! docker ps >/dev/null 2>&1; then
    mkdir -p /var/run/docker /var/lib/docker
    nohup dockerd >/var/log/dockerd.log 2>&1 < /dev/null &
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      docker ps >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  docker ps >/dev/null 2>&1 || echo "warning: Docker daemon failed to start; hyperframes render --docker won't be available this session"
fi
