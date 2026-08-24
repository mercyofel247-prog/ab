# Transition Pipeline

Multi-engine pipeline for applying the 140 magnatesmedia-style transitions to
source clips, splitting the work across Blender, Remotion, HyperFrames, and
ffmpeg by which one each transition actually needs — then assembling
everything into one master file with ffmpeg in a single pass.

Built and validated in a CPU-only cloud sandbox (this session has no GPU —
confirmed via `/dev/dri`, `nvidia-smi`, and Blender's Cycles device
enumeration). Every script here runs correctly on that CPU, at low
resolution/sample counts, to prove correctness. **Real speed requires
running this on your local machine** (AMD RX 9060 XT / Windows, per this
project's setup) via Claude Code's CLI — this cloud session cannot reach
that hardware. See `CLAUDE.md` at the repo root for the render-path
defaults (cloud vs. local).

## Layout

```
transition-pipeline/
├── manifest/
│   ├── build_manifest.py     — parses the source transition list, assigns
│   │                            each of the 140 to an engine + technique
│   └── manifest.json         — the built manifest (engine, technique,
│                                render_mode, gpu notes per transition)
├── blender/
│   └── render_transition.py  — HIP/HIP-RT-aware driver, worked example:
│                                #24 Glass Fracture (rigid-body shatter)
├── hyperframes-scenes/
│   └── 062-split-flap-flip/  — worked example: #62 Mechanical Split-Flap,
│                                canvas-driven, --gpu --browser-gpu wired in
├── ffmpeg/
│   ├── assemble.py           — final assembler: baked/overlay/native modes,
│   │                            single filter_complex pass, AMF hw encode
│   └── cutlist.example.json  — example cutlist exercising all 3 modes
└── orchestrate.py            — reads manifest + cutlist, dispatches each
                                 baked-transition render job across a worker
                                 pool, then calls the assembler
```

The Remotion worked example lives in `remotion-app/src/transitions/` (not
under this directory) so it can reuse `remotion-app`'s existing
`node_modules` — see `remotion-app/render-transition.mjs`.

## Engine split (see manifest.json for all 140)

| Engine | Count | What it's for |
|---|---|---|
| Blender | 47 | physics sims (rigid body, fluid, cloth, particles), photoreal 3D props/materials, volumetric fire/smoke, character rigs |
| HyperFrames | 49 | 2D/HTML-CSS motion graphics, typography, UI, shader effects (WebGL page-side-compositing) |
| Remotion | 22 | simple 3D camera moves via R3F/three.js (card flips, parallax dollies, wireframe builds) — no physics needed |
| ffmpeg (native/overlay) | 22 | stock xfade wipes/dissolves, or practical stock-element overlays (film burn, smoke, embers) via blend modes |

Full reasoning per transition is in each entry's `note` field in
`manifest.json`.

## GPU wiring (AMD RX 9060 XT / RDNA4, Windows)

- **Blender**: `render_transition.py` sets Cycles `compute_device_type =
  "HIP"` and enables every HIP device found, with a defensive HIP-RT toggle
  (attribute name has moved across Blender versions — probes for it rather
  than assuming one). Requires a recent Blender build (RDNA4 support landed
  after 4.0) — verify in Preferences → System → Cycles Render Devices.
- **ffmpeg**: `assemble.py` probes `ffmpeg -encoders` for `av1_amf` /
  `h264_amf` and uses whichever is available, falling back to `libx264` if
  neither is present (which is what happens on this GPU-less sandbox — the
  fallback is live-tested, not hypothetical).
- **Remotion**: `render-transition.mjs` uses the Node.js `renderMedia()` API
  specifically to reach `chromiumOptions.hardwareAcceleration:
  "if-possible"` — confirmed present in this pinned `@remotion/renderer`
  version, but not exposed as a CLI flag on `remotion render`.
- **HyperFrames**: every `package.json` render script and orchestrator
  dispatch includes `--gpu --browser-gpu` (hardware video encode + forced
  Chrome GPU capture), on top of `--page-side-compositing` (on by default,
  ~6x faster for shader-transition renders per `hyperframes render --help`).

## Running it

```bash
# 1. Rebuild the manifest if the source transition list changes
python3 manifest/build_manifest.py /path/to/140_transitions.txt manifest/manifest.json

# 2. Write a cutlist (see ffmpeg/cutlist.example.json) describing your
#    actual source clips, trim points, and which transition id goes where

# 3. Dispatch + assemble — run locally for real GPU acceleration
python3 orchestrate.py \
  --manifest manifest/manifest.json \
  --cutlist your_cutlist.json \
  --renders-dir renders/ \
  --out master.mp4 \
  --concurrency 8   # match your local core count
```

`orchestrate.py` skips any `baked_clip` that already exists on disk, so
re-runs after fixing one transition don't re-render everything.

## What's a full worked example vs. a template

- **Blender** (`render_transition.py`): fully implemented for #24's
  fracture technique specifically. The other 46 Blender-bucket entries need
  their scene-build function swapped in (fluid sim, cloth, character rig,
  PBR prop...) per each entry's `note` field — the HIP/HIP-RT setup, video-
  texture-plane helpers, and render settings are shared and don't change.
- **Remotion** (`TarotCardFlip.tsx`): fully implemented for #20. Uses a CSS
  3D transform (perspective + rotateY) rather than an R3F/WebGL video
  texture — deliberately, since frame-accurate video doesn't map cleanly
  onto a Three.js texture, while a CSS 3D transform is deterministic from
  `frame` alone and is still GPU-composited by Chromium.
- **HyperFrames** (`062-split-flap-flip/`): fully implemented, with one
  documented simplification — a real Solari board hinges each flap at the
  character's vertical center with a two-flap mechanism; this version flips
  each tile a full 180° as one hinge, which is the right complexity for a
  proof-of-concept and still reads as a staggered mechanical cascade.
- **ffmpeg** `NATIVE_XFADE_MAP`: covers every native-bucket id that has a
  clean stock `xfade` equivalent. A handful (Venetian Blind's slat mask,
  VHS tracking distortion, needle-scratch skew) need a bespoke filter graph
  beyond a stock xfade name — those currently fall back to a plain `fade`
  with a build-time warning printed; see the TODO comments next to each in
  `assemble.py`.

## Known bugs found and fixed while building this

Worth knowing about since they're the kind of thing that'd resurface if this
gets refactored:

- Blender: the apt-packaged Blender in this sandbox has no OpenImageDenoise
  — `render_transition.py` catches that specific `RuntimeError` and retries
  with denoising off rather than crashing (the official blender.org build
  includes OIDN, so this is a defensive fallback, not the expected path).
- Remotion: `OffthreadVideo` resolves `src` against the bundle's static
  server root, not the local filesystem — `render-transition.mjs` stages
  source clips into `public/_transition_assets/` *before* calling `bundle()`
  (bundle() copies `public/` once, at bundle time, so staging has to happen
  first) and references them as `/public/_transition_assets/<name>` — the
  bundle nests a `public/` subdirectory rather than merging it into the
  root, which isn't obvious from the docs.
- ffmpeg: the original overlay design tried `blend`-ing the practical
  overlay asset against the *entire* joined stream with `shortest=1`, which
  silently truncated the whole output down to the overlay asset's short
  duration. Fixed by trimming the joined stream into pre/window/post
  segments (via an explicit `split`, since `filter_complex` doesn't allow
  one labeled output to feed multiple downstream filters directly) and only
  blending the `window` segment, then re-concatenating.
- orchestrate.py: originally reconstructed each render's output path as
  `renders_dir / basename`, which didn't match the cutlist's own
  `baked_clip` string — the assembler looked in the wrong place for a file
  that had, in fact, rendered successfully. Fixed by making the cutlist's
  `baked_clip` path the single source of truth for both dispatch and
  assembly.

All caught by actually running each script against synthetic test clips
(`ffmpeg -f lavfi testsrc`) before calling anything done — not just read for
plausibility.
