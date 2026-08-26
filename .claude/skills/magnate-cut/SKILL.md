---
name: magnate-cut
description: End-to-end MagnatesMedia-style money-documentary video editor for Claude Code. Takes provided video clips (Omni-flash scenes) and a provided voice-over narration, generates the missing pieces here in Claude Code — animations (HyperFrames / Remotion / Blender), the S-tier signature transitions (crash-zoom-through-parallax, whip-pan, DOF-rack, slow fly-through), sound effects and background music — then MERGES everything into one finished, mastered video: clips + animations joined by beat-matched S-tier transitions, pushed through one shared colour grade for continuity, with SFX and music beds ducked under the narration and scored silence before the big reveals, all mastered to broadcast spec (1920x1080 @ 24fps, -14 LUFS, true peak <= -1 dBTP). Grounded in the M-HYBRID master prompt (MagnatesMedia cinematic base) and the measured craft lessons from a deep watchutube audit of 8 real money-doc videos. Use this whenever the user wants to assemble, edit, cut, merge, or finish a MagnatesMedia / faceless-money-doc / rise-and-fall documentary video from provided clips + narration — "edit my video," "merge these scenes with transitions," "cut this like MagnatesMedia," "add sound design and music," "assemble the final video," "sync the edit to the voiceover."
---

# magnate-cut: MagnatesMedia-style video assembly & finishing

You (Claude Code) are the EDITOR. Someone else (or an earlier stage) supplies
the raw material; you generate what's missing and cut it all together into a
finished film. This skill is the **merge + finish** pipeline — it does not
write the script (that's the M-HYBRID master prompt) and does not generate the
provided clips (that's Gemini Omni). It takes:

- **Provided:** video clips (Omni-flash cinematic scenes) + the voice-over
  narration (the spine the whole edit syncs to).
- **Generated here in Claude Code:** animations (HyperFrames / Remotion /
  Blender), the S-tier signature transitions, sound effects, background music.
- **Produced by you:** one finished, mastered MP4 — clips + animations joined
  by beat-matched S-tier transitions, one shared grade for continuity, SFX +
  music ducked under the VO with scored silence, mastered to spec.

Everything is grounded in two sources that agree: the **M-HYBRID master
prompt** (the MagnatesMedia cinematic intent) and the **8-video watchutube
audit** (what actually measured well/badly in finished files). Read
`references/lessons-from-8-videos.md` before your first cut — it is the
empirical half and every default here traces to it.

## The delivery spec (non-negotiable pegs)
- **1920×1080, 24fps, 16:9** — the global 1080p lock.
- **−14 LUFS integrated, true peak ≤ −1.0 dBTP** — the #1 audit lesson (7 of 8
  audited videos were clipping over 0 dBTP; only the one correctly-mastered
  reference stood out). `assemble.py` masters to this automatically.
- **One shared colour grade** across every shot (continuity), with the Part 0.5
  accent locked (oxblood OR gold, never both).

## Workflow

### 1. Take stock of what's provided
Put everything in one project directory:
```
<project>/
  clips/            provided Omni-flash scenes (MP4, silent)
  vo/               provided voice-over narration (wav/mp3) — the spine
  animation/        animations you generate (HyperFrames/Remotion/Blender)
  transitions/      signature transition bridges you render (HyperFrames)
  audio/music/      music beds you generate/source
  audio/sfx/        sound effects you generate/source
  overlays/         optional transparent Mode-A elements (kinetic type/arrows)
  renders/          output
  timeline.json     the machine-readable clip table (you author this)
```
Confirm the VO exists and get its duration — the whole edit hangs off it.

### 2. Build the timeline (the machine-readable clip table)
`timeline.json` is the M-HYBRID clip table (master prompt Part 13) expressed as
data `assemble.py` can execute. Schema + field docs:
`references/timeline.schema.json`; a worked example: `examples/timeline.example.json`.

Author it from the script/VO: one `segments[]` entry per shot/beat (a provided
`clip` or a generated `animation`), each with its `transition_out` to the next;
`music[]` chapter beds (rotate tonal families); `sfx[]` events placed in the
gaps; the `grade` look-block; the delivery `meta`. Map narration timing to
segment durations so picture and voice line up.

### 3. Generate the missing visual pieces
- **Animations** (Mode B — data motion, number reveals, kinetic type, charts,
  intros): build with HyperFrames (deepest animation control), Remotion
  (reusable parametric components), or Blender (3D). Follow the repo's existing
  render workflow (the CLAUDE.md cloud-render rule still applies — confirm
  before any cloud render, fall back to local). Render each to `animation/` and
  reference it as a `segment` with `type:"animation"`.
- **Signature transitions** — render the ones you need from `templates/`
  (`crash-zoom-parallax.html`, `whip-pan.html`, `dof-rack.html`,
  `slow-fly-through.html`) to `transitions/`, then point the segment's
  `transition_out.src` at the MP4. See `references/transitions.md`. Native
  transitions (hard_cut/dissolve/fade*/wipe*/smooth*) need no render — the
  assembler does them in ffmpeg.
- **Overlays** (Mode-A kinetic emphasis composited over a cinematic clip):
  render as a transparent MOV — **qtrle or ProRes 4444** (real alpha; VP9/WebM
  alpha is unreliable across ffmpeg builds) — and set the segment's `overlay`.
  The assembler preserves the alpha through scaling.

### 4. Generate the sound design
- **Music beds:** one per chapter, rotate tonal families (serene/tense/epic/
  uplifting — never repeat consecutively). Prefer evolving drone + a recurring
  motif over a wall-to-wall score.
- **SFX:** low booms/subs/risers that mirror the camera move; place them in the
  gaps around the voice (J-cut them slightly ahead of the cut to pull forward).
- **Scored silence:** leave a gap between beds (and no SFX) for ~0.5s before the
  biggest reveal — the loudest moment is the one right before the hit.
Full authority + tiers: `references/audio.md`.

### 5. Assemble + master (the merge)
```bash
python3 .claude/skills/magnate-cut/scripts/assemble.py <project> \
    [--timeline timeline.json] [--out renders/final.mp4] [--draft]
```
It normalizes every segment to 1920×1080@24 + the shared grade, joins them with
the timeline's transitions (native ffmpeg + spliced HyperFrames bridges),
composites overlays, mixes the audio stack (music ducked under VO via real
sidechain compression + SFX in the gaps + scored silence + VO on top), masters
to −14 LUFS / ≤ −1 dBTP, and muxes the final. Use `--draft` for a fast preview
pass; drop it for delivery. It prints one JSON line with the result.

### 6. QC the cut with watchutube — always
Run the `watchutube` skill on the finished MP4 and check it against target:
```bash
python3 .claude/skills/watchutube/scripts/analyze_video.py <project>/renders/final.mp4 --outdir /tmp/mc_qc
```
Verify, from the manifest:
- `metadata.video`: 1920×1080, 24fps, 16:9, SDR.
- `loudness_lufs`: integrated near −14, **true peak ≤ −1.0** (a peak over −1.0
  is a hard fail — re-master).
- `cuts` / transitions: the mix is VARIED (not one locked type), hard cuts land
  on the beat where the music has a pulse (`beat_analysis`), the crash-zoom
  signature is present but not spammed.
- `color_palette`: consistent across the runtime (continuity holding), accent
  locked to the chosen track.
- Look at the frames: grade continuous across cuts, no shot reading as an
  odd-one-out, overlays legible in the title-safe area.
Report what passed and what to fix, then iterate on `timeline.json` and re-run.
Treat watchutube as the edit-bay reference monitor for this pipeline.

## What this skill is NOT
It doesn't write the narrative script (that's the M-HYBRID master prompt →
supply TOPIC + RUNTIME to that separately) and it doesn't generate the provided
cinematic clips (Gemini Omni). It is the deterministic merge + finish stage:
give it clips + VO + a timeline, and it returns a mastered film.

## Notes
- Only ffmpeg/ffprobe are required for the merge itself; they're installed by
  the session-start hook (same as watchutube). HyperFrames/Remotion/Blender are
  only needed for the generation steps and are already set up in this repo.
- The signature transitions load GSAP from its CDN at render time (per the
  master prompt's verbatim exec spec) — that step needs network on the render
  machine; the final `assemble.py` merge does not.
- Re-run safely: `assemble.py` writes only to the `--out` path and a temp dir;
  point `--out` somewhere new to keep versions.
- Grounding docs: `references/lessons-from-8-videos.md` (the audit findings),
  `references/transitions.md`, `references/audio.md`,
  `references/timeline.schema.json`.
