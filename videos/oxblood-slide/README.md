# Oxblood Microscope-Slide Hero — Blender Mode B build (v2.32)

A 3.0 s (72-frame) cinematic 3D shot built entirely from real geometry with
PBR materials, F-curve motion on non-linear Bezier interpolation, and a Cycles
alpha (transparent-film) render for compositing under a master grade.

- **Scene:** 1920×1080 @ 24fps, strict 16:9, frames `0..72` (`0 ms .. 3000 ms`).
- **Hero:** a microscope-slide built as actual extruded/beveled mesh — a dark
  brushed-metal frame + a real refractive glass plate, size-locked to ~80% frame
  width, centred, horizontal. A trapped low-poly human silhouette sits under the
  glass, revealed by a cold clinical transillumination under-light. The oxblood
  `#7A160E` data-spike is a thin **emissive** mesh line (never a flat fill) — the
  only non-neutral element in the frame.
- **Materials (PBR):** metal `metalness ≈ 0.9 / roughness ≈ 0.35`; glass with real
  transmission/refraction (`IOR 1.46`); oxblood as an emissive material on the
  spike line.
- **Lighting:** ONE directional key raking L→R + a cool rim on the metal edge +
  the cold clinical under-light / transillumination panel on the specimen, with a
  soft contact shadow caught on the ground plane (composites onto the alpha).
- **Engine:** Cycles (glass refraction + emissive), compositor **Fog-Glow** glare
  for the light-leak bloom wash. `film_transparent` on → alpha out.

## Motion timeline (all F-curves Bezier, no linear/constant, full coverage)

| ms | frames | beat |
|----|--------|------|
| 0–600     | 0–14  | slide settles in; ambient camera push `1.000→1.010` (ease-in-out); specimen under-light + transillumination fade up |
| 600–1500  | 14–36 | oxblood spike **grows upward** (scale-Z line-draw build, power ease-out) — the winner emerging from the data |
| 1500–1650 | 36–40 | **LAND** (sync frame 36, VO word "winners"): ≥4 simultaneous moves — spike snaps to full emissive + impact push-through `1.00→1.12→1.00` (sanctioned overshoot-and-settle) + ~6-unit camera-shake damping out + emissive bloom + "WINNERS" caption settle |
| 1650–2600 | 40–62 | **sustained** ambient push `1.01→1.05`; spike emissive breathes ±5%; under-light holds — no dead air |
| 2600–3000 | 62–72 | **EXIT**: all motion settled, HOLD-not-fade (editor hard-cuts) |

**Audio sync:** a timeline marker `LAND_subboom_f36` marks frame 36 — bind a deep
sub-boom + light-leak bloom wash there (sub-boom, not a bright whoosh; camera-shake
sub-rumble tail after). Audio is layered in the edit under the master grade.

## Build & render

```bash
# build the scene + save the .blend + render a single test frame
blender -b -P build_scene.py -- --engine CYCLES --samples 128 \
        --save oxblood_slide.blend --test 36

# full animation render -> renders/frames/f_####.png (RGBA / alpha)
blender -b -P build_scene.py -- --engine CYCLES --samples 96 \
        --save oxblood_slide.blend --anim

# quick low-res motion contact sheet for a chosen frame list
blender -b -P verify_motion.py -- oxblood_slide.blend renders 0,8,24,38,52,72

# encode the alpha PNG sequence to a preview MP4 (over black)
ffmpeg -framerate 24 -i renders/frames/f_%04d.png \
       -c:v libx264 -pix_fmt yuv420p -crf 16 renders/oxblood_slide.mp4
```

> **GPU note:** `build_scene.py` sets `cycles.device = 'CPU'` because the render
> was produced in a headless container with no GPU attached. On a machine with a
> CUDA/HIP/OptiX/Metal GPU, enable it in Preferences → System (or set the device
> in the script) and Cycles will use it — the scene is otherwise identical.
> This Blender build also ships without OpenImageDenoise, so quality is carried by
> sample count + adaptive sampling rather than a denoiser.
