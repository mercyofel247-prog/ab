#!/usr/bin/env bash
# Generate a 25s beat-aligned VO narration track for KineticIntro.
#
# Neural TTS (Piper/HuggingFace) is blocked by the sandbox egress policy, so
# this uses espeak-ng and shapes it with ffmpeg (pitch down, band-limit,
# compression, a little room) into a stylized "case-file" narrator. Each line
# is placed at a specific beat so VO resolves on the same downbeats as the
# type and motion. Swap public/vo.mp3 for a human/premium VO later.
set -euo pipefail

OUT_DIR="$(cd "$(dirname "$0")/../remotion-app/public" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# line text | delay(ms from t=0, = beat*500)
LINES=(
  "The money moved.  Before anyone noticed.|1500"
  "Forty seven million dollars.|8000"
  "Extracted in eighteen months.|11000"
  "Routed through nine shell entities.|13500"
  "It was never.  About the money.|17500"
  "O B I O B I.|23000"
  "Get the full breakdown.|24000"
)

INPUTS=()
FILTER=""
i=0
for entry in "${LINES[@]}"; do
  text="${entry%|*}"
  delay="${entry##*|}"
  raw="$TMP/raw_$i.wav"
  proc="$TMP/proc_$i.wav"
  # Male-ish variant, slow and low for gravitas.
  espeak-ng -v en-us+m3 -s 148 -p 22 -g 6 -w "$raw" "$text"
  # Shape: band-limit, compress, add a touch of room, then delay to its beat.
  ffmpeg -y -loglevel error -i "$raw" -af \
    "highpass=f=95,lowpass=f=8200,acompressor=threshold=-18dB:ratio=3:attack=5:release=140,aecho=0.8:0.88:55:0.22,adelay=${delay}|${delay},apad=whole_dur=25" \
    -ar 44100 -ac 2 "$proc"
  INPUTS+=(-i "$proc")
  FILTER+="[$i:a]"
  i=$((i + 1))
done

# Mix all placed lines, trim to exactly 25s, and normalize.
ffmpeg -y -loglevel error "${INPUTS[@]}" -filter_complex \
  "${FILTER}amix=inputs=${i}:normalize=0[m];[m]atrim=0:25,loudnorm=I=-16:TP=-1.5[out]" \
  -map "[out]" -ar 44100 -ac 2 -codec:a libmp3lame -q:a 3 "$OUT_DIR/vo.mp3"

echo "wrote $OUT_DIR/vo.mp3"
