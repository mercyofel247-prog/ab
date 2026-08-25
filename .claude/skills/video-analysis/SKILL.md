---
name: video-analysis
description: Produces an extremely detailed, timestamped shot-by-shot breakdown of a video file — camera framing and movement, composition, color and lighting, cut rhythm and pacing, on-screen text/graphics, motion, and audio dynamics. Use this whenever the user wants a video watched, reviewed, critiqued, analyzed, or broken down in real detail — reviewing a rendered output from this project's Remotion/HyperFrames pipeline, checking a draft before a final render, or studying a reference/inspiration clip to match its style when generating new content. Trigger even on casual phrasing like "take a look at this video", "how does this look", "watch this and tell me what you think", or "analyze this clip" whenever an actual video file (.mp4/.mov/.webm/etc.) is involved — a single glance at one frame is not enough for what this skill is for.
---

# Video Analysis

## Why this exists

Claude can't play a video file directly — but it can look at a well-chosen
sequence of still frames plus an audio waveform and reconstruct, in real
detail, what actually happens in the video: framing, movement, pacing, color,
edit rhythm, on-screen text, and the shape of the audio. The quality of that
analysis depends entirely on which frames get pulled. One frame every 5
seconds tells you almost nothing about a fast-cut sequence; the trick is
pulling a frame at *every shot boundary* (so nothing gets missed between
samples) plus a dense enough uniform sample to see motion and pacing within
each shot.

This is why the skill runs a purpose-built extraction step before any
analysis happens, rather than eyeballing the video with a couple of
`ffmpeg -ss` grabs. It's also why this works with no API dependency: this
whole pipeline is local ffmpeg/ffprobe, so it doesn't need Gemini billing or
any other external service to be available (see the note at the bottom about
`gemini-mcp` as an optional alternative).

## Step 1 — Extract frames, scene cuts, and audio

Run the bundled script:

```bash
python3 .claude/skills/video-analysis/scripts/extract_frames.py <video_path> [output_dir]
```

This does three things in one pass:
1. **Scene-cut frames** — one frame at every detected shot boundary (via
   ffmpeg's `scene` detection filter), so every distinct shot is represented
   even in fast-cut sequences.
2. **Uniform dense sampling** — evenly spaced frames across the whole
   duration (frame count scales with length, capped so it stays readable),
   to catch camera movement and motion *within* a shot, not just at cuts.
3. **Audio** — a waveform image (`waveform.png`) and detected silence
   intervals, giving you the audio's dynamic shape (music swells, pauses,
   dialogue vs. silence) without needing speech-to-text.

It writes everything to `<output_dir>/` (defaults to
`<video_dir>/<video_name>_analysis/`) along with a `manifest.json` listing
every frame's filename and timestamp, the video's metadata (duration, fps,
resolution), and the audio findings. Read `manifest.json` first to know
what you're working with and to get exact timestamps for the report.

If the video is unusually long (multiple minutes) or a first pass produces
too many near-duplicate frames, re-run with `--scene-threshold` raised
(fewer, more confident cuts) or `--max-uniform-frames` lowered — don't just
push through hundreds of frames if the video doesn't call for it.

There's no separate transcription step by default — if a speech-to-text
tool happens to be available in the environment, feel free to use it for
dialogue-heavy content, but don't treat its absence as a blocker. The
waveform and silence intervals already tell you a great deal about the
audio's structure and pacing.

## Step 2 — Actually look at the frames

Read every extracted frame in timestamp order with the Read tool (they're
plain PNGs — Claude's vision handles these natively). Also read
`waveform.png` if audio was present. Don't sample a subset of the extracted
frames to save time — the extraction step already did the work of keeping
the frame count reasonable; skipping frames now defeats the point.

While reading, actively look for, per frame and across sequences of frames:
- **Framing & composition**: shot size (wide/medium/close), rule of thirds,
  headroom, symmetry, what's in focus vs. background
- **Camera movement**: implied pans/tilts/zooms/handheld motion, inferred by
  comparing consecutive frames within a shot
- **Color & lighting**: palette, contrast, warm/cool grading, motivated vs.
  stylized lighting, consistency across shots
- **On-screen text/graphics**: exact wording, timing, style, legibility
- **Motion & subject**: what's moving, how fast, any tracked subjects

## Step 3 — Write the report

Use this structure — fill it in with what you actually observed, not
placeholder language:

```markdown
# Video Analysis: <filename>

## Overview
Duration, resolution, fps, shot count, one-paragraph overall impression.

## Shot-by-Shot Breakdown
A table or numbered list, one entry per shot:
| # | Timestamp range | Description | Framing/Movement | Color/Lighting |

## Pacing & Edit Rhythm
Average shot length, cut frequency over time (does it accelerate/slow down?),
any rhythmic pattern (e.g. cuts on a beat), longest/shortest shots and why
they stand out.

## On-Screen Text & Graphics
Every distinct piece of on-screen text/graphic, with timestamp and a note on
style/legibility.

## Audio
What the waveform and silence intervals suggest — music vs. quiet stretches,
sync between audio hits and cuts, overall loudness shape. Note explicitly if
there was no audio track.

## Notes / Critique
Anything that stood out — technical issues (flicker, clipping, jarring cuts),
strengths worth preserving, or specific suggestions if the user is reviewing
a draft.
```

Keep the shot-by-shot section genuinely detailed — this is the whole point
of the skill. A vague one-line-per-shot summary is a sign the frame reading
step was rushed, not that the video was simple.

## Optional: Gemini native video understanding

`gemini-mcp/` in this repo wraps the Gemini API, whose models have native
video understanding (temporal motion, audio, the works) — a
higher-fidelity alternative to frame-sampling *if* Gemini API billing is
enabled and working (it has not been reliably available in this project).
If it's confirmed working, upload the video via that server and ask a
video-capable model to analyze it directly; treat that as a supplement or
cross-check, not a replacement, since the frame-extraction path above works
regardless of any external service's availability.
