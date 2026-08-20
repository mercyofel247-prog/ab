#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# HyperFrames peak-setup session hook.
#
# The web/cloud container is ephemeral: node_modules, pip packages, the Chrome
# render browser, built binaries, and installed agent skills are all wiped when
# the container is reclaimed. This hook restores the full HyperFrames toolchain
# on every session so local authoring, rendering, TTS, BGM, and transcription
# all work at peak without manual setup.
#
# Layout:
#   Required (session aborts if these fail): remotion deps, ffmpeg,
#     hyperframes CLI, Chrome render browser, agent skills.
#   Optional AI stack (never aborts the session): Kokoro TTS, MusicGen BGM,
#     whisper.cpp transcription. Set HYPERFRAMES_SKIP_AI=1 to skip the heavy
#     Python/ML installs for a faster session start.
# ---------------------------------------------------------------------------

HF_VERSION="0.7.107"   # pinned to match videos/*/package.json for reproducible renders

log() { printf '\n[hyperframes-setup] %s\n' "$1"; }

# --- Remotion project deps (remotion-app/node_modules is gitignored) --------
if [ -f "$CLAUDE_PROJECT_DIR/remotion-app/package.json" ]; then
  log "Installing remotion-app dependencies"
  (cd "$CLAUDE_PROJECT_DIR/remotion-app" && npm install)
fi

# --- ffmpeg/ffprobe (hyperframes uses these for encoding/probing) -----------
if ! command -v ffmpeg >/dev/null 2>&1; then
  log "Installing ffmpeg"
  apt-get update -qq
  apt-get install -y -qq ffmpeg
fi

# --- HyperFrames CLI --------------------------------------------------------
log "Installing hyperframes@${HF_VERSION} (global)"
npm install -g "hyperframes@${HF_VERSION}"

# Work around hyperframes shipping its CLI entry point without the exec bit set
HYPERFRAMES_BIN="$(npm root -g)/hyperframes/bin/hyperframes.mjs"
if [ -f "$HYPERFRAMES_BIN" ]; then
  chmod +x "$HYPERFRAMES_BIN"
fi

# --- Chrome render browser (required for local rendering) -------------------
log "Ensuring Chrome Headless Shell for rendering"
hyperframes browser ensure

# --- Agent skills (HyperFrames + GSAP patterns for AI coding tools) ---------
log "Installing/refreshing HyperFrames agent skills"
hyperframes skills update || log "WARN: skills update failed (non-fatal)"

# --- Optional local AI stack: TTS / BGM / transcription ---------------------
# Heavy (torch + transformers ~ several GB). Guarded so a network hiccup never
# breaks session start. Skip entirely with HYPERFRAMES_SKIP_AI=1.
if [ "${HYPERFRAMES_SKIP_AI:-0}" != "1" ]; then
  if command -v pip3 >/dev/null 2>&1; then
    # Kokoro TTS (local voiceover) + shared audio deps
    log "Installing Kokoro TTS + audio deps (kokoro-onnx, soundfile, numpy)"
    pip3 install --break-system-packages -q kokoro-onnx soundfile numpy \
      || log "WARN: Kokoro/audio deps install failed (non-fatal)"

    # MusicGen BGM (local music fallback). torch must come from PyPI —
    # the proxy blocks download.pytorch.org (the CPU wheel index).
    log "Installing MusicGen deps (transformers, torch — this is the heavy step)"
    pip3 install --break-system-packages -q transformers torch \
      || log "WARN: MusicGen deps install failed (non-fatal)"
  else
    log "WARN: pip3 not found — skipping local TTS/BGM install"
  fi

  # whisper.cpp (word-level transcription for captions/subtitles)
  if ! command -v whisper-cli >/dev/null 2>&1; then
    log "Building whisper.cpp for transcription"
    WHISPER_DIR="${HOME}/whisper.cpp"
    if [ ! -d "$WHISPER_DIR" ]; then
      git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR" \
        || log "WARN: whisper.cpp clone failed (non-fatal)"
    fi
    if [ -d "$WHISPER_DIR" ]; then
      (
        cd "$WHISPER_DIR" \
          && cmake -B build -DCMAKE_BUILD_TYPE=Release >/dev/null 2>&1 \
          && cmake --build build --config Release -j"$(nproc)" >/dev/null 2>&1
      ) || log "WARN: whisper.cpp build failed (non-fatal)"
      if [ -x "$WHISPER_DIR/build/bin/whisper-cli" ]; then
        ln -sf "$WHISPER_DIR/build/bin/whisper-cli" /usr/local/bin/whisper-cli
        ln -sf "$WHISPER_DIR/build/bin/whisper-cli" /usr/local/bin/whisper-cpp
      fi
    fi
  fi
fi

log "Setup complete — run 'hyperframes doctor' to verify."
