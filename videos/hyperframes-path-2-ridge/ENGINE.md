# HyperFrames Path 2 — Ridge/Sky Parallax Engine

A still-image reveal: one photograph, split into two depth planes by mask,
moved by a camera + differential parallax, dressed with front-plane dust and
a fixed grade. Alternative implementation path to "Omni" for the same class
of still-image reveal.

**Motion level:** the original spec called for near-imperceptible movement
(2%/3%/0.8% scale deltas, "AWE LEVER: minimal"). On the placeholder still —
mostly flat black, little edge detail — that read as motionless, so the
deltas were bumped up on request (see "Camera" below). If a future still has
enough texture that the original subtle deltas read clearly, dial back down;
the mechanism doesn't change, only the numbers.

## Source

Source the still at up to 3840×2160 for quality headroom (`assets/still-
placeholder.png` here — **temporary stand-in**, see "Swapping in the real
still" below); `object-fit: cover` downsamples it onto whatever the
composition canvas is. Do not crop or pre-process it beyond that; the engine
reveals it, it never reshapes it.

**Composition canvas defaults to 1920×1080**, not the source's native 4K.
This is a render-cost decision, not a creative one: this engine's grade runs
a WebGL shader (vignette/grain/chromatic aberration) over two full-frame
image layers, and on GPU-less render hardware that shader's `ReadPixels`
readback is the bottleneck — 4K made single frames take **1–1.5 minutes
each** (a 360-frame render would run many hours). 1080p is 4x fewer pixels
for that same shader and renders practically on CPU-only hardware. Set
`--resolution landscape-4k` at render time (or raise `data-width`/
`data-height` back to 3840x2160) once real GPU-accelerated render capacity
is available — nothing else about the engine changes; the still still
sources at full quality either way.

## Two planes, one image, split by mask

`index.html` renders the same `<img>` twice — `#plane-sky` and
`#plane-ridge` — each masked to its own band with `mask-image` /
`-webkit-mask-image` (`--horizon` / `--feather` custom properties in the
`:root`). Because both layers sample identical source pixels, the feathered
seam is invisible at rest; it only shows a few sub-pixels of parallax
mismatch during the camera move, which reads as depth, not a seam.

- `foreground_ridge` — bottom band, parallax scale **1.15 → 1.00**
- `sky` — upper band, parallax scale **1.04 → 1.00**

The differential between those two numbers *is* the depth cue. Nothing else
about the two planes differs — same grade, same duration, same ease.

## Camera

A `.camera` wrapper around both planes scales **1.08 → 1.00**,
`power2.inOut`, over `MOVE_FRAMES` (4 of the 12 beat frames = 4s at the
1 frame/second beat rate this project uses). `power2.inOut` eases both
ends — never linear.

These deltas (camera 8%, ridge 15%, sky 4%) are well above the original
"uncomfortably slow / minimal" spec (2%/3%/0.8%) — bumped up because the
subtle version was invisible against the placeholder still. Still eased
both ends, still never linear, still confined to the first `MOVE_FRAMES`
seconds; only the magnitude changed.

## AWE LEVER

Depth parallax is still the *only* lever pulled for "awe" — no exposure
ramp, no pans, no reveals, no second camera phase. Restraint now applies to
*what* moves, not how far; if the shot needs more weight, extend the *hold*
(more static frames), not the move, and don't reach for other levers.

## Additive: dust

`#dust` sits as a sibling *after* `.camera` in the DOM, not inside it — it
deliberately does not ride the container/parallax scale. That's what reads
it as closer to the viewer than the graded plate: the background moves a
hair, the dust in front of it doesn't move with it, only drifts on its own
slow paths. Layer opacity is fixed at **0.14**. Particle count, size, and
per-particle paths are generated at load time from a seeded PRNG
(`mulberry32`, seed `88`) — deterministic, so the same frame always renders
the same dust position. Never swap this for `Math.random()`.

## Grade

Applied through the framework's canonical `data-color-grading` contract via
`hyperframes media-treatment` (see `hyperframes-agent-media-use` skill —
never hand-rolled CSS filters/SVG for primitives the platform already owns),
identically on both plane `<img>` elements so the grain pattern and vignette
align across the mask seam:

```bash
hyperframes media-treatment --selector "#plane-sky img" --grading '{
  "details": { "vignette": 0.85, "vignetteFeather": 0.55, "vignetteMidpoint": 0.45,
               "grain": 0.08, "grainSize": 0.25 },
  "effects": { "chromaticAberration": 0.12, "chromaticAngle": 0 }
}' --apply
```

(repeated for `#plane-ridge img`). Grain 0.08 = the requested 8%; vignette
0.85 (of the finishing family's 0–1 range) = heavy. **Known deviation:**
the platform's `chromaticAberration` primitive is a uniform single-pass
effect with no radius/falloff control, so "edge-only" isn't literally
achievable through the canonical primitive — it's applied at a restrained
uniform 0.12 instead, which the heavy vignette mostly masks in the (already
dark, low-detail) center. If a true radial edge-only falloff is a hard
requirement, that needs a platform capability that doesn't exist yet, not a
bespoke SVG filter grafted on top of the canonical grade.

## LOCK

- Never warp or morph the base pixels — the two `<img>` elements are never
  displaced, distorted, or content-aware anything. Everything visible is a
  `transform: scale(...)` on a wrapper, plus the canonical grade layer, plus
  the additive dust overlay.
- Combined max scale is camera 1.08 × ridge parallax 1.15 ≈ 1.242 at t=0 —
  **24% beyond source resolution, outside the original "inner 90%" cap.**
  Documented deviation: the cap was sized for the original minimal deltas: it
  doesn't leave headroom for the bumped-up motion above and was knowingly
  traded away for visible movement. Still fine in practice (`object-fit:
  cover` + real photo detail have plenty of margin at 24% overscan), but if
  the "inner 90%" constraint turns out to be a hard requirement, the camera/
  parallax deltas need to come back down, not this note revised away.
- Final 8 of the 12 beat frames (`frame-05`…`frame-12`, seconds 4–12) are
  static except dust: the camera/parallax tweens are 4s long and are never
  touched again after that — nothing re-tweens `#camera`, `#plane-sky`, or
  `#plane-ridge` past `MOVE_FRAMES`.

## Frame structure (12 minimum, extendable)

`index.html` labels the timeline `frame-01` … `frame-12`, one per second:

| Frames | Time    | What moves                       |
| ------ | ------- | --------------------------------- |
| 1–4    | 0s–4s   | camera scale + differential parallax |
| 5–12   | 4s–12s  | nothing but dust                  |

To extend: raise `TOTAL` in the `<script>` and add more labels — the hold
logic needs no changes, since "static" is just "no tween touches it," not an
explicit freeze step. `MOVE_FRAMES` should stay fixed; only the hold grows.

## Swapping in the real still

1. Replace `assets/still-placeholder.png` with the real 3840×2160 photo
   (same filename, or update both `<img src>` attributes).
2. Re-tune `--horizon` / `--feather` in `:root` to the photo's actual
   horizon line — the placeholder's is at 80% from the top; a real photo
   will differ.
3. Re-run `npm run check`, then `npx hyperframes snapshot` at
   `frame-01`/`frame-04`/`frame-12` to confirm the seam is still invisible
   and the grade still reads correctly against the new pixels.
4. `npm run render`.
