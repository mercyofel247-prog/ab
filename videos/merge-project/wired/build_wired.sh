#!/usr/bin/env bash
# Wires the Blender glass-shatter transition into the 5-scene merge, replacing
# the spotlight-blackout cut (3->4) with a real physics shatter.
# Usage: ./build_wired.sh   (run from videos/merge-project/)
set -euo pipefail
cd "$(dirname "$0")/.."
I=incoming
mkdir -p renders wired

# segment A: scenes 1-3 (bleed + whip-pan), ends at the natural end of scene3
ffmpeg -y -v error -i "$I/01_scene1.mp4" -i "$I/02_scene2.mp4" -i "$I/03_scene3.mp4" \
  -filter_complex_script wired/segment_a.graph \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k \
  wired/segment_a.mp4

# segment B: scenes 4-5 (crash push-in + shockwave), starts fresh
ffmpeg -y -v error -i "$I/04_scene5.mp4" -i "$I/05_scene8.mp4" \
  -filter_complex_script wired/segment_b.graph \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k \
  wired/segment_b.mp4

# mux the synthesized crash sound onto the Blender shatter render
ffmpeg -y -v error -i ../blender-transitions/glass_shatter_transition.mp4 -i wired/shatter_sfx.wav \
  -c:v copy -c:a aac -b:a 192k -shortest wired/glass_shatter_with_audio.mp4

# concat: segment A -> glass shatter insert -> segment B
ffmpeg -y -v error -stats \
  -i wired/segment_a.mp4 -i wired/glass_shatter_with_audio.mp4 -i wired/segment_b.mp4 \
  -filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[vout][aout]" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart \
  renders/magnatesmedia_merge_v2_glassshatter.mp4

echo "Wrote renders/magnatesmedia_merge_v2_glassshatter.mp4"
