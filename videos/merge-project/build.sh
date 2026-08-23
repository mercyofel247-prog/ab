#!/usr/bin/env bash
# Merge the 5 source clips with 4 MagnatesMedia-style transitions.
# Usage: ./build.sh   (run from videos/merge-project/)
set -euo pipefail
cd "$(dirname "$0")"
I=incoming
mkdir -p renders

ffmpeg -y -stats \
 -i "$I/01_scene1.mp4" \
 -i "$I/02_scene2.mp4" \
 -i "$I/03_scene3.mp4" \
 -i "$I/04_scene5.mp4" \
 -i "$I/05_scene8.mp4" \
 -filter_complex_script transitions.graph \
 -map "[vout]" -map "[aout]" \
 -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p \
 -c:a aac -b:a 192k -movflags +faststart \
 renders/magnatesmedia_merge.mp4

echo "Wrote renders/magnatesmedia_merge.mp4"
