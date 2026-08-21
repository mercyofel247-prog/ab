#!/usr/bin/env bash
# remotion-amf.sh — render a Remotion composition, then hardware-encode the
# result with whatever GPU video encoder the machine actually has:
#   Linux  + AMD  -> h264_vaapi   (via /dev/dri/renderD128)
#   Windows + AMD -> h264_amf
#   macOS         -> h264_videotoolbox
# If no hardware encoder is usable, it keeps Remotion's CPU (libx264) output.
#
# Why this exists: Remotion's built-in hardware encode (--hardware-acceleration)
# only supports NVENC (Linux/Windows) and VideoToolbox (macOS) — there is NO AMD
# VAAPI/AMF path, so on an AMD GPU it falls back to CPU libx264. This wrapper adds
# the AMD encoders. HyperFrames already auto-detects them. The WebGL *rasterization*
# still
# runs on the GPU automatically via remotion.config.ts — this only swaps the
# final H.264 encode onto the GPU.
#
# Usage:
#   ./remotion-amf.sh <compositionId> <output.mp4> [extra remotion render args...]
# Example:
#   ./remotion-amf.sh Ch1-06 out/ch1_06.mp4 --concurrency=100%

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <compositionId> <output.mp4> [extra remotion render args...]" >&2
  exit 2
fi

COMP="$1"; OUT="$2"; shift 2
EXTRA=("$@")

mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp -u).intermediate.mp4"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

FFMPEG="${FFMPEG:-ffmpeg}"

echo ">> [1/2] Remotion render (GPU raster via remotion.config.ts) -> high-quality intermediate"
npx remotion render "$COMP" "$TMP" --crf=12 ${EXTRA[@]+"${EXTRA[@]}"}

# Does this ffmpeg have the encoder compiled in?
have_enc() { "$FFMPEG" -hide_banner -encoders 2>/dev/null | grep -q " $1 "; }
OS="$(uname -s 2>/dev/null || echo unknown)"

HW=""; HWARGS=()
case "$OS" in
  Linux)
    if [ -e /dev/dri/renderD128 ] && have_enc h264_vaapi; then
      HW="h264_vaapi (AMD/VAAPI, Linux)"
      HWARGS=(-vaapi_device /dev/dri/renderD128 -i "$TMP" -vf 'format=nv12,hwupload' -c:v h264_vaapi -qp 20)
    fi ;;
  Darwin)
    if have_enc h264_videotoolbox; then
      HW="h264_videotoolbox (macOS)"
      HWARGS=(-i "$TMP" -c:v h264_videotoolbox -q:v 55)
    fi ;;
  MINGW*|MSYS*|CYGWIN*)
    if have_enc h264_amf; then
      HW="h264_amf (AMD, Windows)"
      HWARGS=(-i "$TMP" -c:v h264_amf -rc cqp -qp_i 20 -qp_p 20 -quality quality)
    fi ;;
esac

if [ -n "$HW" ]; then
  echo ">> [2/2] GPU encode: $HW -> $OUT"
  if "$FFMPEG" -y -hide_banner -loglevel error "${HWARGS[@]}" -c:a copy "$OUT"; then
    echo "   done (GPU-encoded)."
    exit 0
  fi
  echo "   GPU encode failed (driver/permissions?); falling back to the CPU render." >&2
fi

echo ">> [2/2] No usable GPU encoder detected -> keeping the CPU-encoded render"
mv -f "$TMP" "$OUT"
echo "   done (CPU encode: libx264)."
