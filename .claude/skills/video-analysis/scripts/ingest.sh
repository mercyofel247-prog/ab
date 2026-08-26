#!/usr/bin/env bash
# ingest.sh — get a video onto local disk so analyze_video.py can run on it.
#
# Accepts EITHER a local file path OR a URL (YouTube, Vimeo, direct .mp4, etc.).
# For URLs it uses yt-dlp, and also tries to pull the creator's own captions
# (much better than machine transcription when they exist).
#
# Usage:
#   ingest.sh <url-or-path> <outdir>
#
# On success prints two lines to stdout:
#   VIDEO=<absolute path to the downloaded/target video file>
#   SUBS=<absolute path to a .vtt/.srt subtitle file, or "none">
#
# NOTE ON NETWORK: some environments (e.g. the Claude Code web sandbox) block
# outbound egress by policy, so URL downloads fail with a proxy 403. That is an
# environment restriction, not a bug here — run this in local Claude Code, or
# download the file elsewhere and pass the local path instead.
set -euo pipefail

SRC="${1:?usage: ingest.sh <url-or-path> <outdir>}"
OUT="${2:?usage: ingest.sh <url-or-path> <outdir>}"
mkdir -p "$OUT"

# --- Local file path -------------------------------------------------------
if [ -f "$SRC" ]; then
  ABS="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"
  echo "VIDEO=$ABS"
  # look for a sidecar subtitle next to it
  base="${ABS%.*}"
  for ext in vtt srt; do
    if [ -f "$base.$ext" ]; then echo "SUBS=$base.$ext"; exit 0; fi
  done
  echo "SUBS=none"
  exit 0
fi

# --- URL -------------------------------------------------------------------
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp not installed; installing…" >&2
  pip3 install -q yt-dlp >&2 || {
    echo "ERROR: could not install yt-dlp and '$SRC' is not a local file." >&2
    exit 1
  }
fi

echo "Downloading with yt-dlp: $SRC" >&2
# Cap at 1080p to keep files sane; merge to mp4. Grab subs if present.
yt-dlp \
  -f "bv*[height<=1080]+ba/b[height<=1080]/b" \
  --merge-output-format mp4 \
  --write-subs --write-auto-subs --sub-langs "en.*,en" --sub-format "vtt/srt" \
  --restrict-filenames \
  -o "$OUT/%(id)s.%(ext)s" \
  "$SRC" >&2 || {
    echo "ERROR: yt-dlp failed. If this is the web sandbox, egress is blocked by" >&2
    echo "policy (proxy 403) — download the file elsewhere and pass its local path." >&2
    exit 1
  }

VID="$(find "$OUT" -maxdepth 1 -type f \( -name '*.mp4' -o -name '*.mkv' -o -name '*.webm' \) | head -1)"
[ -n "$VID" ] || { echo "ERROR: no video file produced." >&2; exit 1; }
echo "VIDEO=$(cd "$(dirname "$VID")" && pwd)/$(basename "$VID")"

SUB="$(find "$OUT" -maxdepth 1 -type f \( -name '*.vtt' -o -name '*.srt' \) | head -1 || true)"
if [ -n "$SUB" ]; then
  echo "SUBS=$(cd "$(dirname "$SUB")" && pwd)/$(basename "$SUB")"
else
  echo "SUBS=none"
fi
