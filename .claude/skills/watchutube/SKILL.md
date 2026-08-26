---
name: watchutube
description: Deep, evidence-based analysis of a video's editing and craft -- cuts and transitions (hard cut, fade, dissolve, wipe candidate, automatically classified from frame-diff evidence, not guessed), pacing (shot lengths, cuts per minute, pacing curve, plus a motion/energy curve that catches camera movement within a shot), sound design (music/silence/dialogue map, loudness spikes that likely mark sound effects or hits, music tempo/BPM and whether cuts land on the beat), voice-over (transcript, words-per-minute, pauses), on-screen text/captions (OCR), face/subject presence, and technical/visual metrics (resolution, fps, color and brightness trends, freeze frames, black frames) -- plus an auto-generated visual HTML timeline of the whole analysis. Use this whenever the user wants a video "watched," reviewed, or analyzed -- for a local video file (uploaded/attached, or an MP4 sitting in the repo, e.g. a rendered video under videos/*/renders), or for a video URL such as a YouTube link. Trigger on requests like "analyze this video," "check the pacing of this edit," "how's the sound design," "watch this and tell me about the transitions," "review my voice-over timing," "does this cut on the beat," or any ask for feedback on editing/transitions/pacing/sound effects/voice-over/on-screen text in a video -- even if the user doesn't name this skill directly.
---

# watchutube: deep video analysis

You (Claude) cannot literally play video or hear audio. This skill closes
that gap: `scripts/analyze_video.py` runs ffmpeg/ffprobe/OpenCV/librosa
passes that turn a video into structured evidence -- exact timestamps for
cuts (both hard cuts *and* gradual fades/dissolves, which are structurally
invisible to naive scene detection -- see below), each one pre-classified by
transition type from real frame-diff evidence, a motion/energy curve, music
tempo and beat alignment, silence/loudness, freeze/black frames, brightness,
face-presence and on-screen-text detection, and (when possible) a
timestamped voice-over transcript -- plus a curated set of still frames at
the moments that matter, and a self-contained visual timeline.html. Your job
is to run that script, then actually look at the frames it extracted, read
the JSON/transcript, and synthesize all of it into a real analysis. The
script now does real classification work, not just detection -- but it's
still evidence for you to weigh and sanity-check against what you can
actually see, not a verdict to transcribe uncritically.

Don't try to reimplement the ffmpeg/OpenCV pipelines yourself -- they're
already tuned and validated against known ground truth (synthetic test
clips with known cut points, fades, and dissolves, plus real project
renders). Just call the script.

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
   - `--cut-threshold` (default 0.28) -- sensitivity of the *hard*-cut
     detector (0-1). Lower it if the script reports suspiciously few hard
     cuts for a fast-cut edit; raise it if a video with lots of internal
     motion (pans, zooms) is producing false-positive cuts. This does not
     affect fade/dissolve detection, which is a separate pass.
   - `--skip-advanced` to fall back to just the original core pass (cuts,
     pacing, silence, black/freeze, loudness, brightness, transcript, frames)
     and skip transition classification, the fade/dissolve scan, motion
     curve, face detection, OCR, beat detection, and the timeline -- useful
     for a quick pass on a long video where you only need the basics fast.
   - `--skip-faces`, `--skip-ocr`, `--skip-beat-detection`, `--skip-timeline`
     to selectively drop one of the advanced passes (e.g. skip OCR on a
     video you already know has no on-screen text, to save time).
   - `--max-classified-cuts N` (default 40) -- cap on how many cuts get full
     frame-diff transition classification, for videos with an extreme
     number of cuts.

   The script prints one JSON line to stdout when done, e.g.
   `{"ok": true, "outdir": "...", "manifest": ".../manifest.json", "timeline_html": ".../timeline.html", "num_frames": 30, "num_cuts": 14, "transcript_available": true, "beat_analysis_available": true, "warnings": []}`.
   A long video (many minutes) can take a while -- most of the cost is
   ffmpeg/OpenCV decoding the file several times over (once per detector
   pass) plus transcription. Run it and wait for it to finish rather than
   backgrounding it and guessing at results.

   If `"ok": false`, read the `"error"` field -- it's almost always either a
   bad path/URL or ffmpeg/ffprobe missing from PATH.

3. **Read `manifest.json`** (path given in the script's output). It contains
   everything: `metadata`, `cuts` (each with a `transition` sub-object once
   classified), `pacing`, `silence`, `black_frames`, `freeze_frames`,
   `loudness_curve`, `loudness_spikes_candidate_sfx`, `brightness_curve`,
   `motion_curve`, `faces_summary`, `on_screen_text`, `beat_analysis`,
   `transcript`, `frames`, and `warnings`. See `references/metrics.md` for
   what each field means and how to reason about it -- read that file
   before writing the report if you haven't used this skill before in this
   session.

4. **Look at the frames -- to verify, not to guess from scratch.** Each cut
   in `cuts` already carries a `transition` classification (`hard_cut`,
   `fade_to/from_black`, `fade_to/from_white`, `dissolve/cross_fade`, or
   `wipe_candidate`) computed from an actual frame-diff burst around that
   timestamp, with a `confidence` and supporting `detail` numbers -- this
   is real evidence, not a guess. Still use the Read tool on a
   representative spread of the images in `frames/` (before/after pairs at
   `cut_<t>s_before` / `cut_<t>s_after`, and `interval_*` frames sampling
   the whole runtime) so your report describes what's actually *in* each
   shot, not just how it changes. Treat a `confidence` below ~0.5, or a
   `wipe_candidate` result, as "worth a visual double-check" rather than
   final -- wipe detection in particular is a coarse heuristic (spatially
   asymmetric change) and can be wrong; say so if the frames don't back it
   up. Cuts near the start/end of a cut-heavy video may lack a
   `transition` field if they fell outside `--max-classified-cuts` --
   don't invent a type for those, just note it wasn't classified.

5. **Read the transcript** (if `transcript.available` is true) for the
   voice-over content and pacing (`words_per_minute`, `pauses`). If it's
   false, read `transcript.reason` and tell the user plainly why (no audio
   track, transcription library unavailable, or -- common in sandboxed
   environments -- the Whisper model download was blocked by network
   policy). Don't silently drop this section; a missing transcript is a
   real limitation the user should know about, not something to paper over.

6. **Fold in the other advanced signals:**
   - `motion_curve`: visual-change intensity over time, independent of
     cuts -- use it to describe energy within a single unbroken shot (a
     handheld pan, an action sequence) that cut-counting alone would miss.
   - `beat_analysis`: if available, the detected tempo (BPM) and what
     fraction of cuts land on/near a beat (`cuts_on_beat_pct`) -- a real
     "does this cut to the music" signal for music-driven edits. High
     alignment is worth calling out as a deliberate editorial choice;
     don't over-read it on a video without a strong musical pulse.
   - `faces_summary` / per-frame `faces` count: how much of the sampled
     footage shows a visible face -- useful for "talking-head heavy" vs.
     "b-roll/abstract" framing of the visual style.
   - `on_screen_text`: OCR'd burned-in text/captions/titles with
     timestamps, if `available` (needs the `tesseract` binary -- see
     Notes). Skip this section of the report if unavailable rather than
     claiming there's no on-screen text.

7. **Write the report.** Use your own judgment on structure for a short
   clip, but for a full deep-analysis request use this shape:

   ```markdown
   ## Overview
   [duration, resolution, fps, codec, one-line read on genre/style]

   ## Transitions & Cuts
   [table or list: timestamp -> transition type (from the script's
   classification) -> confidence -> brief visual note from actually
   looking at the frames per step 4]

   ## Pacing
   [shot length stats, cuts/minute, how it changes over the runtime --
   read the pacing_curve_per_minute and motion_curve together to describe
   the rhythm: does it speed up, stay steady, breathe at certain points,
   or carry energy through motion within shots rather than cuts?]

   ## Sound Design
   [silence/dialogue/music segments, tempo/BPM and cut-to-beat alignment
   if available, loudness spike timestamps as candidate SFX/hits -- be
   clear these are volume-spike candidates you detected numerically, not
   confirmed sound identifications, since you can't actually hear the audio]

   ## Voice-Over
   [WPM, pause pattern, notable transcript excerpts, or a clear note that
   no transcript was available and why]

   ## Visual Style
   [what the sampled frames show: color/brightness trends, framing,
   face presence, on-screen text if any -- from actually looking at the
   images plus the faces_summary/on_screen_text data]

   ## Notable Moments
   [timestamped callouts worth the user's attention]

   ## Limitations
   [always include this -- see below]
   ```

   Also mention `timeline.html` (path from the script's output) as a
   visual companion to the written report -- it plots cuts, motion,
   loudness, brightness, beat grid, and voice-over segments on one shared
   timeline. Tell the user where it is (they can open it directly), and
   offer to publish a polished version via the Artifact tool (following
   the `dataviz`/`artifact-design` skills) if they want something
   shareable -- that's optional, the script's own timeline.html is already
   a real, useful deliverable on its own.

8. **Always disclose limitations** in the report, briefly: transition
   classification and audio-event detection come from numeric signals and
   still frames rather than watching/listening in real time, so treat
   low-confidence or `wipe_candidate` results as provisional; hard-cut
   detection can still miss extremely subtle cuts or false-positive on fast
   camera motion; the fade/dissolve scanner is a heuristic tuned on
   synthetic and real test clips but not infallible; loudness spikes are
   volume-based candidates, not confirmed sound-effect identification; beat
   detection assumes a reasonably steady tempo and is less meaningful on
   music without a clear pulse; transcription accuracy depends on audio
   quality and the Whisper model size used (or may be unavailable entirely
   -- say why if so); OCR can miss stylized or low-contrast text.

## Notes

- The script is idempotent and safe to re-run with different flags (e.g.
  a tighter `--cut-threshold`) if the first pass looks off -- just point
  `--outdir` somewhere new so you don't clobber frames you already looked
  at.
- For a video already in this repo's `videos/*/renders/`, prefer analyzing
  the actual rendered MP4 over re-rendering anything.
- yt-dlp, faster-whisper, opencv-python-headless (pinned to a 4.x release --
  the 5.x line dropped the classic face-detection API the bundled cascade
  needs), and librosa are installed lazily by the script on first use if
  missing (via pip) -- this needs outbound network access. `tesseract-ocr`
  (for on-screen text) is a system binary the script does NOT install
  automatically since that needs root/apt, not just pip -- if OCR reports
  unavailable and the user cares about on-screen text, you can offer to run
  `apt-get install -y tesseract-ocr` yourself (with confirmation, since
  installing system packages is exactly the kind of action worth checking
  before doing) and re-run.
- If pip installs or the Whisper model download are blocked by an egress
  policy (as they can be in sandboxed sessions), the script degrades
  gracefully section by section: cuts/pacing/sound/visual analysis still
  work fully since they only need ffmpeg, and each advanced feature that
  couldn't run reports why (`transcript.reason`, or a `[watchutube]
  WARNING` in stderr surfaced in `warnings`) rather than silently
  producing nothing.
