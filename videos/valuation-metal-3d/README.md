# Valuation — $4.5B · 3D metal hero (HyperFrames · Three.js + GSAP)

Path 1 — "the graphic IS the shot." A single extruded **$4.5B** metal numeral on
near-black, built entirely in code (Three.js), animated by GSAP, in the Track-2
oxblood look. B-anchor continuity.

## Shot spec (as briefed)

| | |
|---|---|
| Canvas | 1920×1080, strict 16:9 |
| Frame rate | 30 fps |
| Duration | 3s (90 frames) |
| Engine | Three.js (WebGL) + GSAP — **no default easing** (every tween names its ease) |
| Register | dimensional lit editorial — machined dark-metal hero, single studio key, soft contact shadow, specular highlight, shallow DoF, layered depth planes |
| Palette | near-black `#0B0B0C–#141416`, warm-bone `#EDE8DD`, oxblood `#7A160E` (emissive edge glow only), graphite `#3A3A3E` |
| Grade | applied later as ONE master LUT (~60%) + ~6% grain in DaVinci — **not** baked here |
| Audio | none — render SILENT |
| VO / sync | "Worth four and a half billion dollars — on paper." · `[LAND:billion]` |

## The three named depth planes (the AWE lever)

Real 3D parallax — the camera **trucks** in x (orientation fixed), so the planes
separate by their distance from the lens:

- **Z0 (front) — hero:** the single extruded `$4.5B` mesh (`TextGeometry`,
  bevelled) under the key light.
- **Z1 (mid) — label:** `PAPER NET WORTH`, drawn to a canvas texture (bone, unlit).
- **Z2 (back) — graphite depth panels:** machined slabs that read the parallax.

## Timeline (all eases explicit)

- **f0–f72** — camera x drifts **−3%** of world width on **`expo.out`**.
- **f10–f50** — specular **oxblood rim sweeps the top edges** (position on
  `sine.inOut`, intensity up on `expo.out` / down on `power3.in`).
- **f0–f24** — landing settle for `[LAND:billion]`: a uniform scale seats on
  `expo.out` (uniform only — never a warp).

The GSAP timeline is paused and seeked by the HyperFrames runtime; a
timeline-level `onUpdate` re-renders the WebGL canvas each seek
(`preserveDrawingBuffer` so headless screenshots capture it).

### LOCK compliance

- **Single numeral instance, no duplication** — one `TextGeometry` mesh; the
  centring is a geometry translate, not a copy.
- **No warp** — only camera truck + uniform scale + light/shader animation; no
  shear/skew/non-uniform scale on the glyphs.
- **Oxblood is edge-only** — injected via a Fresnel × top-facing × sweep mask in
  the hero material's shader (`onBeforeCompile`), so it glows the top edges and
  never fills a face.

## Assets are generated, not uploaded

- `assets/hero-font.typeface.json` — a **subset** of Liberation Sans Bold
  (`$ 4 . 5 B` only), converted by `tools/build-font.mjs`. Inlined into
  `index.html` so it parses synchronously with no runtime network fetch.
- `vendor/three.bundle.js` — Three + `FontLoader` + `TextGeometry` bundled to a
  single global IIFE by esbuild (`tools/three-entry.mjs`), so the composition is
  a classic synchronous script (no ES-module load race against the readiness
  poll).

Regenerate both with:

```bash
npm run build:assets   # (installs tools deps, rebuilds font subset + three bundle)
```

`tools/` is build-time only and its `node_modules/` is git-ignored.

## Commands

```bash
npm run dev      # preview server (long-running — keep alive in background)
npm run check    # lint + runtime + layout + motion + contrast
npm run render   # render to MP4 at 1920×1080 @30fps, high quality (silent)
```

## Reusing across valuation beats

Change the numeral + label text in `index.html` (`new TextGeometry("$4.5B", …)`
and the `fillText("PAPER NET WORTH", …)` line); if a new value needs glyphs
outside `$ 4 . 5 B`, add those characters to `CHARS` in `tools/build-font.mjs`
and rerun `npm run build:assets`.
