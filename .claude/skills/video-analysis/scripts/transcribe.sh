#!/usr/bin/env bash
# transcribe.sh — produce a timestamped transcript of the voiceover / dialogue.
#
# Tiered, so it works in as many environments as possible:
#   1. If a subtitle file (.vtt/.srt) is passed, just clean it into plain text
#      with timestamps  (best + free + offline — use creator captions).
#   2. Else if `whisper` (openai-whisper) or `faster-whisper` is installed,
#      transcribe the audio locally.
#   3. Else print guidance and exit non-zero (caller falls back to reading
#      on-screen text from extracted frames).
#
# Usage:
#   transcribe.sh <video-or-audio-file> <outdir> [subs-file]
#
# Writes: <outdir>/transcript.txt   (and transcript.vtt when whisper is used)
set -euo pipefail

MEDIA="${1:?usage: transcribe.sh <media> <outdir> [subs]}"
OUT="${2:?usage: transcribe.sh <media> <outdir> [subs]}"
SUBS="${3:-none}"
mkdir -p "$OUT"

# --- 1. Reuse existing captions -------------------------------------------
if [ "$SUBS" != "none" ] && [ -f "$SUBS" ]; then
  echo "Using provided captions: $SUBS" >&2
  # Strip VTT/SRT markup, keep cue start-times as [mm:ss] prefixes, de-dupe.
  python3 - "$SUBS" > "$OUT/transcript.txt" <<'PY'
import re, sys
lines = open(sys.argv[1], encoding="utf-8", errors="ignore").read().splitlines()
out, last, cur_ts = [], None, ""
ts_re = re.compile(r"(\d{2}):(\d{2}):(\d{2})[.,]\d+\s*-->")
for ln in lines:
    m = ts_re.search(ln)
    if m:
        h, mm, ss = int(m.group(1)), int(m.group(2)), int(m.group(3))
        cur_ts = f"[{h*60+mm:02d}:{ss:02d}]"
        continue
    if ln.strip() in ("", "WEBVTT") or ln.strip().isdigit():
        continue
    txt = re.sub(r"<[^>]+>", "", ln).strip()          # inline tags
    txt = re.sub(r"\{[^}]+\}", "", txt).strip()
    if txt and txt != last:
        out.append(f"{cur_ts} {txt}" if cur_ts else txt)
        last = txt
print("\n".join(out))
PY
  echo "Wrote $OUT/transcript.txt (from captions)" >&2
  exit 0
fi

# --- 2. Local whisper ------------------------------------------------------
if command -v whisper >/dev/null 2>&1; then
  echo "Transcribing with openai-whisper (this can be slow on CPU)…" >&2
  whisper "$MEDIA" --model small --output_format vtt --output_dir "$OUT" >&2
  vtt="$(find "$OUT" -name '*.vtt' | head -1)"
  [ -n "$vtt" ] && cp "$vtt" "$OUT/transcript.vtt" && \
    "$0" "$MEDIA" "$OUT" "$OUT/transcript.vtt"
  exit 0
fi

if python3 -c "import faster_whisper" 2>/dev/null; then
  echo "Transcribing with faster-whisper…" >&2
  python3 - "$MEDIA" "$OUT" <<'PY'
import sys
from faster_whisper import WhisperModel
media, out = sys.argv[1], sys.argv[2]
model = WhisperModel("small", device="cpu", compute_type="int8")
segments, info = model.transcribe(media, vad_filter=True)
with open(f"{out}/transcript.txt", "w", encoding="utf-8") as f:
    for s in segments:
        m, sec = divmod(int(s.start), 60)
        f.write(f"[{m:02d}:{sec:02d}] {s.text.strip()}\n")
print(f"Wrote {out}/transcript.txt (faster-whisper)")
PY
  exit 0
fi

# --- 3. Nothing available --------------------------------------------------
cat >&2 <<'MSG'
No transcript source available:
  - no caption file was passed, and
  - neither `whisper` nor `faster-whisper` is installed.
Options:
  * pip install faster-whisper   (local, needs to download a model once)
  * pip install -U openai-whisper
  * or pass captions via ingest.sh (yt-dlp --write-auto-subs)
Falling back: Claude will read on-screen text from the extracted frames instead.
MSG
exit 3
