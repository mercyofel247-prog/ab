---
name: watchUtube
description: >-
  Watch and deeply analyse any video — from a URL (YouTube, Vimeo, direct link)
  or a local file — for editing/creation reference. Use whenever the user wants
  a video watched, analysed, broken down, reverse-engineered, or its style
  studied: pacing and cuts-per-minute, shot length, transitions, sound design
  and SFX, music, voiceover and script, typography and motion graphics, color,
  retention devices, and an overall style fingerprint. Triggers on "analyse this
  video", "watch this YouTube video", "break down this edit", "what's the editing
  style", MagnatesMedia/documentary-style study, or any pasted video URL to study.
allowed-tools: Bash, Read, Write, WebFetch, WebSearch
---

# Video Analysis

Turn any video into something you can actually *see* and measure, then produce a
deep, reproducible breakdown. The pipeline: **ingest → analyze (ffmpeg) →
transcribe → look at the frames → write the report** against a fixed rubric.

You cannot stream a video's audio/pixels directly. This skill converts the video
into artifacts you CAN consume: extracted frames (you Read them with vision),
contact-sheet montages (whole video at a glance), a timestamped transcript, and
hard metrics from ffmpeg (cut timing, loudness, silence).

## When to use
Any request to watch, analyse, break down, reverse-engineer, or study the style
of a video — by URL or local file. Also for "make/edit a video like <ref>": run
this on the reference first to get the style fingerprint, then brief the edit
against it.

## Prerequisites (check once)
- `ffmpeg` and `ffprobe` on PATH — required (they do all offline work).
- `yt-dlp` — only for URL downloads; `ingest.sh` auto-installs it via pip.
- Transcription is tiered and optional (see step 3).

> **Network note:** In the Claude Code **web sandbox**, outbound egress is blocked
> by policy, so URL downloads fail with a proxy 403 (this is the environment, not
> the skill). In that case ask the user to either (a) run this in **local Claude
> Code**, where YouTube downloads work, or (b) upload/provide the video file and
> pass its local path. All frame/audio/metric analysis then works fully offline.

## Workflow

Let `SKILL=.claude/skills/watchUtube` and pick a working dir, e.g.
`WORK=$(mktemp -d)/va` (or a scratchpad path). Then:

### 1. Ingest — get the file locally
```bash
bash "$SKILL/scripts/ingest.sh" "<URL-or-local-path>" "$WORK"
```
It prints `VIDEO=<path>` and `SUBS=<path|none>`. Capture both. If it fails on a
URL due to egress, fall back per the network note above.

### 2. Analyze — extract frames + metrics (offline, always works)
```bash
python3 "$SKILL/scripts/analyze_video.py" "<VIDEO>" --out "$WORK/analysis" \
  --interval 3 --scene-threshold 0.30
```
Tuning: raise `--interval` for long videos (fewer frames); lower
`--scene-threshold` (e.g. 0.2) if too few cuts are detected, raise it (0.4+) if
every tiny motion is counted. Produces `analysis/analysis.json`, `cuts.json`,
and the `frames/` tree. For long videos also raise `--montage-*` or `--interval`
so you don't drown in frames.

### 3. Transcribe — get the voiceover/script
```bash
bash "$SKILL/scripts/transcribe.sh" "<VIDEO>" "$WORK/analysis" "<SUBS-or-none>"
```
Tiers: reuse creator captions if present → local whisper/faster-whisper if
installed → otherwise it exits 3 and you rely on on-screen text read from frames.
Writes `analysis/transcript.txt` when it can.

### 4. Watch — actually look at it
- **Read the contact sheets first:** `analysis/frames/montage/sheet_*.jpg`.
  These give you the whole video's look, color, source mix, and visual variety
  in a few images.
- **Read the cut frames:** `analysis/frames/cuts/cut_*.jpg` (named with their
  timestamps) to study composition, on-screen text, and what changes across each
  transition.
- **Read timeline frames** `analysis/frames/timeline/t_*.jpg` for coverage the
  cuts miss. Read a representative spread — you don't need every frame; sample
  across the runtime and zoom into reveal/hook moments.
- Read `analysis/analysis.json`, `cuts.json`, and `transcript.txt` for the numbers
  and script. Optionally `WebSearch` the title/creator for extra context (works
  even when downloads are blocked).

### 5. Report — write the breakdown
Apply **`references/analysis-framework.md`** across all 9 axes (structure,
pacing, visual language, transitions, typography/motion, sound design, VO/script,
retention engineering, style fingerprint). Fill in
**`references/report-template.md`**. Rules:
- Cite **real numbers** from `analysis.json` and **real timestamps** from
  `cuts.json`/frame filenames. Never invent metrics or timings.
- Mark anything inferred (e.g. exact fonts, SFX names) as an estimate.
- End with the **Reproduction Brief** — the checklist to create/edit in this
  style — since that's what downstream video work is briefed against.

For multiple videos (e.g. a batch of URLs), run steps 1–4 per video, then also
produce a short **cross-video pattern summary**: what's consistent across the
channel (the repeatable formula) vs what varies per video.

## Output
Deliver the filled-in report in chat. If the user wants a shareable artifact,
offer to publish it (an HTML Artifact reads well for a visual breakdown). Keep
the `$WORK/analysis` folder around so frames can be re-examined on follow-ups.

## Files
- `scripts/ingest.sh` — URL/local → local file (+ captions) via yt-dlp.
- `scripts/analyze_video.py` — ffmpeg/ffprobe engine: metadata, scene cuts,
  frames, montages, loudness, silence → `analysis.json`.
- `scripts/transcribe.sh` — captions/whisper → `transcript.txt`.
- `references/analysis-framework.md` — the 9-axis deep-analysis rubric.
- `references/report-template.md` — the report skeleton to fill in.
