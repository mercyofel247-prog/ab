# Translation notes — Remotion → HyperFrames

Source: `remotion-app/src/Composition.tsx` (the default Remotion starter demo).
Target: this HyperFrames composition (`index.html`).

## Why this is a re-creation, not a mechanical source port

`scripts/lint_source.py` (from the `remotion-to-hyperframes` skill) flagged one
**blocker**:

```
Composition.tsx:70 [blocker] r2hf/use-effect-deps:
  useLayoutEffect/useEffect with non-empty deps — side effects don't translate
  to HF's seek-driven model
```

That `useLayoutEffect([frame, fps])` is the Remotion GSAP seek-bridge (build a
paused timeline once, `seek(frame / fps)` each render). The skill's rule refuses
a mechanical translation whenever any blocker fires, and recommends either the
Remotion-Player runtime-interop pattern (PR #214) or a fresh native build. For a
3-second demo the interop bundle is overkill, so this composition was **rebuilt
natively in HyperFrames** — a single paused `gsap.timeline` that HF seeks
frame-by-frame, which is the exact deterministic model the blocker exists to
protect.

## What changed vs. the Remotion source

| Remotion element | HyperFrames equivalent | Fidelity |
| ---------------- | ---------------------- | -------- |
| `GsapTitle` (fade/rise/scale, `back.out(2)`) | `#title` GSAP tween, same ease | Faithful |
| `MovingBox` via `interpolate([-100, width+100])` | `#box` GSAP `x: -100 → 1380`, linear, clamped by tween bounds | Faithful |
| `RotatingCube` via `@remotion/three` (WebGL) | `#cube` CSS 3D transform cube, GSAP `rotationX/Y` | **Approximated.** A CSS-3D cube, not a lit Three.js mesh. Faces use a top-left→bottom-right gradient plus per-face `brightness()` to fake a fixed key light, and a blurred radial `.cube-glow` (kept off the `preserve-3d` chain so its filter can't flatten the 3D) gives it presence. Rotation reproduces `frame/30` (X ≈ 172°) and `frame/20` (Y ≈ 258°) over 90 frames as a linear tween. |
| `CameraMotionBlur` (shutterAngle 180, 10 samples) on the box | `#box` + `#box-motion-blur` SVG `feGaussianBlur` | **Approximated** (was dropped in the first pass). A seeked renderer can't integrate over shutter time, so a constant directional X-axis blur (`stdDeviation="16 0"`) fakes the constant-velocity smear — faithful because the box moves at constant speed the whole clip. Follows the `motion-blur-streak` rule's constant-velocity guidance. |
| Title text "Remotion + GSAP + Three.js" | "HyperFrames + GSAP + 3D" | Updated to reflect the new stack. |

## Added polish (beyond the source)

These have no Remotion counterpart — added to match the finish of the
`data-beat-8-8t` project:

- **Reflective floor** — a faint horizon wash (`#floor`) plus a soft mirrored
  accent glow under the cube (`#floor-reflection`), grounding it above a glossy
  surface.
- **Vignette** — `#vignette` radial edge-darken for a cinematic frame.
- **Audio sting** — a short whoosh on the title/motion entrance (`assets/whoosh.mp3`,
  t=0) and a bass impact as the title settles (`assets/impact.mp3`, t≈0.85s), both
  from the media-use bundled SFX library, wired as `<audio>` tracks.

## Specs preserved

- 1280×720, 30 fps, 90 frames (3.0 s).
- Black background, element positions match the source (title `top:60`, cube
  region `top:160 left:440`, box `top:580`).

## Rendering

Renders on HeyGen cloud by default (`npm run render` → `hyperframes cloud
render`). See the repo's `HEYGEN.md`. The original `remotion-app/` project is
left untouched.
