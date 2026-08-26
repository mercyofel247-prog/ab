# Transitions — the S-tier set and how the pipeline renders them

Two sources agree and are fused here: the master prompt's Part 14.6 (the
MagnatesMedia signature transitions) and the measured 8-video grammar
(`lessons-from-8-videos.md` §3–5). A transition is authored as `transition_out`
on a segment in `timeline.json`.

## The rule that governs all of them
- **Vary them.** The only bans are jump cuts and flashy-preset spam. A single
  locked transition type across a chunk flattens the video (continuity finding).
- **Match the beat energy** (§3): hard cuts carry fast/data segments; dissolves
  and fades carry contemplative beats; the crash-zoom is the reserved signature
  for the biggest promise→reality reveals — a few per video, never routine.
- **Voice always wins:** a transition's SFX (riser/whoosh/boom) lands in the
  gap around the narration, never on a stressed word (Part 18 R0).
- **Mirror the move with sound** (Part 10.2): push-in → riser + sub-thud; whip
  → whip-whoosh + hard pop; crash-zoom → riser into a sub-drop on the land;
  fade-to-black → drop toward the scored-silence vacuum.

## How each type is produced

| timeline `type` | How the pipeline renders it | When to use |
|---|---|---|
| `hard_cut` | ffmpeg, 1-frame join (reads as a straight cut) | fast data/list/hype beats; the default workhorse of a driving segment. Land it on a beat where the music has a pulse (§5). |
| `dissolve` | ffmpeg `xfade=fade` | soft scene changes; section breaks; the cinematic all-dissolve grammar (§3). |
| `fadeblack` | ffmpeg `xfade=fadeblack` | act breaks; the clean out-point — pair with music `fade_out_s` for the fade-to-black + fade-to-silence ending (§4). |
| `fadewhite` | ffmpeg `xfade=fadewhite` | bright reveals / time jumps; use sparingly (one video over-leaned on it and it read flashy). |
| `wipeleft/right/up/down` | ffmpeg `xfade=wipe*` | directional segment breaks; graphic-driven beats. |
| `smoothleft/right` | ffmpeg `xfade=smooth*` | gentler directional push than a wipe. |
| `whip_pan` | native `smoothleft` approx, OR splice `templates/whip-pan.html` render via `src` | high-energy segment breaks; ~8 frames. The HyperFrames version adds the real directional-blur ramp. |
| `dof_rack` | native `fade` approx, OR splice `templates/dof-rack.html` via `src` | shift attention WITHIN a composite instead of cutting; contemplative. |
| **`crash_zoom`** | splice a pre-rendered `templates/crash-zoom-parallax.html` via `src` | **the signature.** Big reveals, promise→reality hard cuts. ~14 frames / 0.58s. |
| `fly_through` | splice `templates/slow-fly-through.html` via `src` | the contemplative sibling of the crash-zoom; ~40 frames, no blur ramp. |

Native transitions need nothing but the two neighbouring clips. The
HyperFrames signatures (`crash_zoom`, `fly_through`, and optionally
`whip_pan`/`dof_rack`) are their OWN short renders spliced BETWEEN the two
shots — build them first, then point `transition_out.src` at the MP4.

## The crash-zoom recipe (master prompt 14.6.3 — the reference build)
Rendered by `templates/crash-zoom-parallax.html`. The two craft details that
separate premium from preset (14.6.4):
1. **Graph-editor-shaped easing, not defaults** — explicit `cubic-bezier()`
   values (accelerate `cubic-bezier(0.55,0,1,0.45)` into the crash, decelerate
   `cubic-bezier(0.16,1,0.3,1)` onto the land), never a bare `power2.inOut`.
2. **Motion blur ON during the fast phase, ramped in and back out** (0→18px→0)
   and **fully resolved to 0 before the final frame** so shot B lands clean.
   Without the blur ramp a crash-zoom reads as cheap scaling.
Inputs: shot A separated into fg/mid/far parallax planes (reuse the masks from
that shot's build) at Z −200 / −600 / −1400px, and shot B flat at Z −2600px.
ONE axis of motion only (Z); no rotation. Same shared grade + continuous grain
across the cut (§6).

## Rendering a HyperFrames transition (verbatim exec spec, master prompt 14.7)
Transforms only (scale / translateZ / opacity) + CSS `filter: blur()`;
GSAP from its CDN; `window.__timelines["main-video"] = tl` (paused); the root
carries `data-composition-id/width/height/fps/duration`; deterministic (no
`Math.random`/`Date.now`/network in the motion). Render:
```
npx hyperframes render <projectdir> -c crash-zoom-parallax.html \
    -f 24 -q draft -w auto --gpu --browser-gpu --strict -o renders/crashNN.mp4
```
(GSAP loads from CDN at render time — needs network on the render machine.)
