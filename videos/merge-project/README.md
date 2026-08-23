# merge-project — MagnatesMedia-style clip merge

Merges 5 source clips into one edit using 4 transitions modeled on the
MagnatesMedia YouTube channel's style. Every cut hands off the **red accent**
that runs through all five scenes (droplet → device glow → table warmth →
spotlight → seam), which is what makes the montage read as authored rather
than assembled.

## Build

```bash
./build.sh          # needs ffmpeg on PATH; writes renders/magnatesmedia_merge.mp4
```

All clips are normalized to **1920x1080 / 24fps / yuv420p** (scene 1 is
upscaled from 720p) and audio is crossfaded at every seam.

## Scene order & transitions

| Cut | From → To | Transition | Family |
|-----|-----------|-----------|--------|
| 1→2 | red droplet → woman w/ glowing device | Organic blood/ink bleed (wobbly reveal from the droplet, red-tinted, softened edge) | organic matte |
| 2→3 | woman → boardroom | Whip-pan snap (horizontal blur + chromatic split) | dynamic camera |
| 3→4 | boardroom → spotlight stage | Spotlight blackout (fade through black into the spotlight pool) | light / blackout |
| 4→5 | spotlight → glowing device | Crash push-in + shockwave (zoom-in with chromatic pulse) | camera push |

## Timing (final timeline)

| Transition | Window (s) | Duration |
|-----------|-----------|----------|
| T1 bleed      | 3.30–4.00  | 0.70 |
| T2 whip       | 8.80–9.30  | 0.50 |
| T3 blackout   | 11.90–12.80 | 0.90 |
| T4 push-in    | 15.20–15.90 | 0.70 |

Total runtime ~19.2s.

## Files

- `incoming/` — source clips, renamed in play order.
- `transitions.graph` — the ffmpeg `filter_complex` graph (normalize + xfade
  chain + per-seam flourishes + audio acrossfade). Edit this to tune.
- `build.sh` — runs the render.
- `renders/magnatesmedia_merge.mp4` — the output.

## Tuning notes

- Transition offsets in `transitions.graph` are cumulative on the output
  timeline; if you change a clip duration or a transition `duration`, update
  the downstream `offset` values (each = previous output length − this
  transition's duration).
- The T1 bleed is a custom xfade expr; note this ffmpeg build runs `P` from
  1→0, hence the `(1-P)` terms.
- Higher-fidelity versions of the ink bleed (true fluid turbulence) and the
  whip (ramped directional streak) would be built in Remotion (`remotion-app/`).
