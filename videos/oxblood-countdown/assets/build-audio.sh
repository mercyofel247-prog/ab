#!/bin/bash
# Deterministic premium audio bed for the oxblood countdown.
#  - low tonal drone (root + fifth) for a "premium" foundation
#  - a rising chirp that builds tension across the countdown
#  - airy high shimmer for polish
#  - a hollow, resonant thud landing at 8.5s (zero-hit)
set -euo pipefail
cd "$(dirname "$0")"

FC="sine=frequency=55:duration=10:sample_rate=48000,volume=0.17,aformat=channel_layouts=stereo[d1];"
FC+="sine=frequency=82.41:duration=10:sample_rate=48000,volume=0.075,aformat=channel_layouts=stereo[d2];"
FC+="aevalsrc='0.055*sin(2*PI*(150*t+15.5*t*t))':d=8.6:s=48000,afade=t=in:st=0:d=3.6:curve=ipar,afade=t=out:st=8.15:d=0.45,aformat=channel_layouts=stereo[chirp];"
FC+="anoisesrc=d=10:c=pink:r=48000:amplitude=0.06,highpass=f=1900,tremolo=f=0.18:d=0.6,volume=0.45,aformat=channel_layouts=stereo[air];"
FC+="sine=frequency=67:duration=1.7:sample_rate=48000,afade=t=in:st=0:d=0.004,afade=t=out:st=0.09:d=1.6:curve=exp,aformat=channel_layouts=stereo,adelay=8500|8500[thudA];"
FC+="sine=frequency=44:duration=1.7:sample_rate=48000,afade=t=in:st=0:d=0.004,afade=t=out:st=0.13:d=1.55:curve=exp,volume=0.85,aformat=channel_layouts=stereo,adelay=8500|8500[thudB];"
FC+="anoisesrc=d=0.12:c=white:amplitude=0.5,highpass=f=250,afade=t=out:st=0:d=0.11,volume=0.35,aformat=channel_layouts=stereo,adelay=8500|8500[click];"
FC+="[thudA][thudB][click]amix=inputs=3:normalize=0,aecho=0.85:0.65:55|110:0.45|0.28[thud];"
FC+="[d1][d2][chirp][air][thud]amix=inputs=5:normalize=0:dropout_transition=0,afade=t=in:st=0:d=0.4,afade=t=out:st=9.55:d=0.45,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=0:10"

ffmpeg -y -hide_banner -loglevel error -filter_complex "$FC" -t 10 -ac 2 -ar 48000 -c:a pcm_s16le sound.wav
echo "wrote $(pwd)/sound.wav"
