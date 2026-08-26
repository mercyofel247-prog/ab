---
name: watchutube
description: Deep, evidence-based analysis of a video's editing and craft -- cuts and transitions (hard cut, fade, dissolve, wipe), pacing (shot lengths, cuts per minute, pacing curve), sound design (music/silence/dialogue map, loudness spikes that likely mark sound effects or hits), voice-over (transcript, words-per-minute, pauses), and technical/visual metrics (resolution, fps, color and brightness trends, freeze frames, black frames). Use this whenever the user wants a video "watched," reviewed, or analyzed -- for a local video file (uploaded/attached, or an MP4 sitting in the repo, e.g. a rendered video under videos/*/renders), or for a video URL such as a YouTube link. Trigger on requests like "analyze this video," "check the pacing of this edit," "how's the sound design," "watch this and tell me about the transitions," "review my voice-over timing," or any ask for feedback on editing/transitions/pacing/sound effects/voice-over in a video -- even if the user doesn't name this skill directly.
---

# watchutube: deep video analysis

You (Claude) cannot literally play video or hear audio. This skill closes
that gap: `scripts/analyze_video.py` runs ffmpeg/ffprobe passes that turn a
video into structured evidence -- exact timestamps for cuts, silence,
loudness, freeze/black frames, a brightness curve, and (when possible) a
timestamped voice-over transcript -- plus a curated set of still frames at
the moments that matter. Your job is to run that script, then actually look
at the frames it extracted and read the JSON/transcript, and synthesize all
of it into a real analysis. The script finds *where* things happen; you
judge *what they are* and *whether they work*.

Don't try to reimplement the ffmpeg pipelines yourself -- they're already
tuned and validated (scene-change detection via the `scene` select
expression, silence/black/freeze via ffmpeg's own detect filters, a
windowed RMS loudness curve, etc). Just call the script.

## Workflow

1. **Resolve the input.**
   - Local file: use the path directly (an uploaded/attached video, or an
     existing file like `videos/<project>/renders/<name>.mp4`).
   - URL: pass the URL straight to the script -- it downloads via `yt-dlp`
     itself (capped at 1080p by default to keep things fast). Don't
     pre-download.

2. **Run the analysis script:**
   ```bash
   python3 .claude/skills/watchutube/scripts/analyze_video.py "<path-or-url>" --outdir /tmp/watchutube_<slug>
   ```
   Useful flags:
   - `--skip-transcription` if the video has no voice-over (e.g. pure music)
     or the user only cares about visuals/pacing -- saves real time.
   - `--whisper-model tiny|base|small|medium` (default `base`) -- bump up
     for accuracy on a short/important clip, drop to `tiny` for a quick
     pass on a long one.
   - `--max-frames N` (default 36) -- raise it for a long, cut-heavy video
     you want denser visual coverage of; lower it to keep your own context
     usage down.
   - `--cut-threshold` (default 0.28) -- the scene-change sensitivity
     (0-1). Lower it if the script reports suspiciously few cuts for a
     fast-cut edit; raise it if a video with lots of internal motion (pans,
     zooms) is producing false-positive cuts.

   The script prints one JSON line to stdout when done, e.g.
   `{"ok": true, "outdir": "...", "manifest": ".../manifest.json", "num_frames": 30, "num_cuts": 14, "transcript_available": true, "warnings": []}`.
   A long video (many minutes) can take a while -- most of the cost is
   ffmpeg decoding the file several times over (once per detector pass) plus
   transcription. Run it and wait for it to finish rather than
   backgrounding it and guessing at results.

   If `"ok": false`, read the `"error"` field -- it's almost always either a
   bad path/URL or ffmpeg/ffprobe missing from PATH.

3. **Read `manifest.json`** (path given in the script's output). It contains
   everything: `metadata`, `cuts`, `pacing`, `silence`, `black_frames`,
   `freeze_frames`, `loudness_curve`, `loudness_spikes_candidate_sfx`,
   `brightness_curve`, `transcript`, `frames`, and `warnings`. See
   `references/metrics.md` for what each field means and how to reason
   about it -- read that file before writing the report if you haven't used
   this skill before in this session.

4. **Look at the frames.** This is the step that turns numbers into a real
   analysis -- don't skip it. Use the Read tool on a representative spread
   of the images in the `frames/` directory the script created (the
   `frames` array in the manifest tells you the timestamp and tag --
   `cut_<t>s_before` / `cut_<t>s_after` pairs bracket a specific transition,
   `interval_*` frames sample the video evenly throughout). For each cut you
   report on, look at its before/after pair and actually judge the
   transition type from what you see and the surrounding evidence:
   - Near-identical composition, instant change of content → **hard cut**.
   - Luma mean nose-dives toward 0 (or a `black_frames` entry sits right at
     that timestamp) then recovers → **fade to/from black**.
   - Luma mean spikes toward the max, no black frame → **fade to/from
     white**.
   - The "after" frame looks like a soft blend of both shots rather than a
     clean break → **dissolve/cross-fade**.
   - Content shifts in a directional, spatially-localized way (a line or
     shape sweeping across) → **wipe**.
   When you're not confident from two frames alone, say so rather than
   guessing -- e.g. "cut at 0:42, type unclear from sampled frames."

5. **Read the transcript** (if `transcript.available` is true) for the
   voice-over content and pacing (`words_per_minute`, `pauses`). If it's
   false, read `transcript.reason` and tell the user plainly why (no audio
   track, transcription library unavailable, or -- common in sandboxed
   environments -- the Whisper model download was blocked by network
   policy). Don't silently drop this section; a missing transcript is a
   real limitation the user should know about, not something to paper over.

6. **Write the report.** Use your own judgment on structure for a short
   clip, but for a full deep-analysis request use this shape:

   ```markdown
   ## Overview
   [duration, resolution, fps, codec, one-line read on genre/style]

   ## Transitions & Cuts
   [table or list: timestamp -> transition type -> brief visual note,
   drawn from actually looking at the frames per step 4]

   ## Pacing
   [shot length stats, cuts/minute, how it changes over the runtime --
   read the pacing_curve_per_minute and describe the rhythm: does it
   speed up, stay steady, breathe at certain points?]

   ## Sound Design
   [silence/dialogue/music segments, loudness spike timestamps as
   candidate SFX/hits -- be clear these are volume-spike candidates you
   detected numerically, not confirmed sound identifications, since you
   can't actually hear the audio]

   ## Voice-Over
   [WPM, pause pattern, notable transcript excerpts, or a clear note that
   no transcript was available and why]

   ## Visual Style
   [what the sampled frames show: color/brightness trends, framing,
   on-screen text if any -- from actually looking at the images]

   ## Notable Moments
   [timestamped callouts worth the user's attention]

   ## Limitations
   [always include this -- see below]
   ```

7. **Always disclose limitations** in the report, briefly: you inferred
   transition types and audio events from still frames and numeric signals
   rather than watching/listening in real time; scene-cut detection can
   miss soft cuts or false-positive on fast camera motion; loudness spikes
   are volume-based candidates, not confirmed sound-effect identification;
   transcription accuracy depends on audio quality and the Whisper model
   size used (or may be unavailable entirely -- say why if so).

## Notes

- The script is idempotent and safe to re-run with different flags (e.g.
  a tighter `--cut-threshold`) if the first pass looks off -- just point
  `--outdir` somewhere new so you don't clobber frames you already looked
  at.
- For a video already in this repo's `videos/*/renders/`, prefer analyzing
  the actual rendered MP4 over re-rendering anything.
- yt-dlp and faster-whisper are installed lazily by the script on first use
  if missing (via pip) -- this needs outbound network access. If pip
  installs or the Whisper model download are blocked by an egress policy
  (as they can be in sandboxed sessions), the script degrades gracefully:
  cuts/pacing/sound/visual analysis still work fully since they only need
  ffmpeg, only the transcript step is skipped, with `transcript.reason`
  explaining why.
