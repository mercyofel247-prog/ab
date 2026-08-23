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
| `RotatingCube` via `@remotion/three` (WebGL) | `#cube` CSS 3D transform cube, GSAP `rotationX/Y` | **Approximated** — a CSS cube, not a lit Three.js mesh. No ambient/point lighting model; faces use fixed accent shades for depth. Rotation reproduces `frame/30` (X ≈ 172°) and `frame/20` (Y ≈ 258°) over 90 frames as a linear tween. |
| `CameraMotionBlur` (shutterAngle 180, 10 samples) on the box | — | **Dropped.** Per-sample motion blur isn't reproduced; the box moves without blur. Add via the HyperFrames motion-blur technique later if wanted. |
| Title text "Remotion + GSAP + Three.js" | "HyperFrames + GSAP + 3D" | Updated to reflect the new stack. |

## Specs preserved

- 1280×720, 30 fps, 90 frames (3.0 s).
- Black background, element positions match the source (title `top:60`, cube
  region `top:160 left:440`, box `top:580`).

## Rendering

Renders on HeyGen cloud by default (`npm run render` → `hyperframes cloud
render`). See the repo's `HEYGEN.md`. The original `remotion-app/` project is
left untouched.
