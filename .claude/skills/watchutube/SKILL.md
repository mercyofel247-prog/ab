---
name: watchutube
description: Deep, evidence-based, one-stop analysis of a video's editing and craft -- cuts and transitions (hard cut, fade, dissolve, wipe candidate, automatically classified from frame-diff evidence, not guessed), audio/video edit offset per cut (J-cut/L-cut candidates), pacing (shot lengths, cuts per minute, pacing curve, a motion/energy curve that catches camera movement within a shot, plus per-shot camera-movement classification -- static/pan-tilt/zoom/handheld -- from optical flow), sound design (music/silence/dialogue map, loudness spikes that likely mark sound effects or hits, integrated loudness in LUFS/true-peak/loudness-range for mix/delivery checks, music tempo/BPM and whether cuts land on the beat), voice-over (transcript, words-per-minute, pauses), on-screen text/captions with size-based prominence (title vs. lower-third vs. caption), face/subject presence with a rough shot-framing guess (close-up/medium/wide) from face size, color palette/grading (dominant colors, saturation/brightness signature), and technical/visual/delivery metrics (resolution, aspect ratio, orientation, SDR/HDR, fps, color and brightness trends, freeze frames, black frames) -- plus an auto-generated visual HTML timeline of the whole analysis, all on by default. Use this whenever the user wants a video "watched," reviewed, or analyzed -- for a local video file (uploaded/attached, or an MP4 sitting in the repo, e.g. a rendered video under videos/*/renders), or for a video URL such as a YouTube link. Trigger on requests like "analyze this video," "check the pacing of this edit," "how's the sound design," "watch this and tell me about the transitions," "review my voice-over timing," "does this cut on the beat," "what's the color grading," "is the camera static or moving," or any ask for feedback on editing/transitions/pacing/sound effects/voice-over/on-screen text/color/camera-work in a video -- even if the user doesn't name this skill directly.
---

# watchutube: deep video analysis

You (Claude) cannot literally play video or hear audio. This skill closes
that gap: `scripts/analyze_video.py` runs ffmpeg/ffprobe/OpenCV/librosa
passes that turn a video into structured evidence -- exact timestamps for
cuts (both hard cuts *and* gradual fades/dissolves, which are structurally
invisible to naive scene detection -- see below), each one pre-classified by
transition type from real frame-diff evidence and checked for an
audio/video edit offset (J-cut/L-cut candidates), a motion/energy curve
plus per-shot camera-movement classification (static/pan/zoom/handheld),
music tempo and beat alignment, silence/loudness plus integrated loudness
(LUFS/true-peak/LRA), freeze/black frames, brightness, a color-palette/
grading signature, face-presence with a rough shot-framing guess
(close-up/medium/wide), and on-screen-text detection with size-based
prominence, and (when possible) a timestamped voice-over transcript --
plus a curated set of still frames at the moments that matter, and a
self-contained visual timeline.html. Every one of these passes runs by
default -- this is meant to be a one-stop-shop deep analysis, not a menu
you assemble yourself. Your job is to run that script, then actually look
at the frames it extracted, read the JSON/transcript, and synthesize all
of it into a real analysis. The script does real classification work, not
just detection -- but it's still evidence for you to weigh and
sanity-check against what you can actually see, not a verdict to
transcribe uncritically.

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
   - `--skip-faces`, `--skip-ocr`, `--skip-beat-detection`, `--skip-timeline`,
     `--skip-color`, `--skip-camera-movement`, `--skip-edit-offset` to
     selectively drop one of the advanced passes (e.g. skip OCR on a video
     you already know has no on-screen text, to save time). Everything is
     **on by default** -- this is meant to be a one-stop-shop pass; only
     reach for these to trim cost on a long video where you know a
     particular signal won't matter.
   - `--max-classified-cuts N` (default 40) -- cap on how many cuts get full
     frame-diff transition classification and edit-offset (J-cut/L-cut)
     checking, for videos with an extreme number of cuts.
   - `--max-classified-shots N` (default 24) -- cap on how many shots get
     camera-movement classification, for videos with a huge number of shots.

   The script prints one JSON line to stdout when done, e.g.
   `{"ok": true, "outdir": "...", "manifest": ".../manifest.json", "timeline_html": ".../timeline.html", "num_frames": 30, "num_cuts": 14, "transcript_available": true, "beat_analysis_available": true, "color_palette_available": true, "loudness_lufs_available": true, "num_shots_camera_classified": 18, "warnings": []}`.
   A long video (many minutes) can take a while -- most of the cost is
   ffmpeg/OpenCV decoding the file several times over (once per detector
   pass) plus transcription. Run it and wait for it to finish rather than
   backgrounding it and guessing at results.

   If `"ok": false`, read the `"error"` field -- it's almost always either a
   bad path/URL or ffmpeg/ffprobe missing from PATH.

3. **Read `manifest.json`** (path given in the script's output). It contains
   everything: `metadata` (now also `aspect_ratio`, `orientation`,
   `color_space`/`color_transfer`/`is_hdr`), `cuts` (each with a
   `transition` sub-object and an `edit_offset` sub-object once classified),
   `pacing`, `silence`, `black_frames`, `freeze_frames`, `loudness_curve`,
   `loudness_spikes_candidate_sfx`, `loudness_lufs`, `brightness_curve`,
   `motion_curve`, `camera_movement`, `faces_summary`, `shot_type_summary`,
   `on_screen_text` (with per-detection `prominence_pct`/`prominence_label`),
   `beat_analysis`, `color_palette`, `transcript`, `frames` (with
   `shot_type_guess` on frames with a detected face), and `warnings`. See
   `references/metrics.md` for what each field means and how to reason about
   it -- read that file before writing the report if you haven't used this
   skill before in this session.

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

   `frame_diff_scan`-detected cuts also carry `frame_coverage` and
   `nearby_soft_candidates` (see `references/metrics.md`) -- use these
   together with the actual frames to catch a real failure mode on
   motion-graphics-heavy edits: kinetic-typography text drawing itself on,
   a bar chart growing, an icon spinning, or a graphic scrolling can all
   register as a spurious "dissolve" or "wipe" cut, since to a pure
   frame-diff signal they look identical to a real gradual transition. A
   low `frame_coverage` plus a nonzero `nearby_soft_candidates` (especially
   3+, meaning several such candidates are clustered within a couple
   seconds) is a strong hint you're looking at one continuous on-screen
   animation, not several real cuts -- check the before/after frames: if
   the overall composition/background is the same in both and only a
   foreground graphic element has progressed, say so plainly in the report
   rather than counting it as an edit point. Don't reject a candidate on
   the numbers alone, though -- always confirm against the frames, since a
   real dissolve on dark/sparse footage can also read as low-coverage.

   Each classified cut may also carry an `edit_offset` sub-object --
   `aligned_cut` (audio and video change together, the default/normal
   case), `j_cut_candidate` (the audio jump happens measurably *before* the
   video cut -- next scene's sound leads the picture), `l_cut_candidate`
   (the audio jump happens measurably *after* -- previous scene's sound
   trails into the new shot), or `no_clear_audio_transition` (the audio
   around that cut didn't shift enough to say anything -- not proof there's
   no edit trick there, just no signal). This is a coarse RMS-jump heuristic
   on ~50ms windows, not a real audio-scene-change model -- worth calling
   out J/L-cut candidates as a deliberate editing technique when confidence
   is reasonable, but don't overstate precision.

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
   - `camera_movement`: per-shot classification (`static`, `pan/tilt`,
     `zoom_in`/`zoom_out`, `handheld/shake`) from optical flow, each with a
     `confidence` and the raw flow numbers in `detail` -- this is *what
     kind* of movement drives a shot's motion_curve energy, not just how
     much. Only a sample of shots gets classified (`--max-classified-shots`)
     on a shot-heavy video; don't invent a type for unclassified shots.
     Frame seeking for this pass is timestamp-based and approximate on
     long-GOP codecs, so treat shot boundaries here as approximate.
   - `beat_analysis`: if available, the detected tempo (BPM) and what
     fraction of cuts land on/near a beat (`cuts_on_beat_pct`) -- a real
     "does this cut to the music" signal for music-driven edits. High
     alignment is worth calling out as a deliberate editorial choice;
     don't over-read it on a video without a strong musical pulse.
   - `loudness_lufs`: integrated loudness, true peak, and loudness range --
     the actual broadcast/streaming mix-level standard (unlike the raw
     per-second RMS in `loudness_curve`, which is for spotting relative
     spikes over time). Useful when the user cares about mix/delivery specs,
     not just editorial pacing.
   - `faces_summary` / per-frame `faces` count: how much of the sampled
     footage shows a visible face -- useful for "talking-head heavy" vs.
     "b-roll/abstract" framing of the visual style. `shot_type_summary` (and
     per-frame `shot_type_guess`/`largest_face_frame_area_pct`) gives a
     rough close-up/medium/wide framing breakdown derived from face size --
     only meaningful on frames where a face was actually detected.
   - `on_screen_text`: OCR'd burned-in text/captions/titles with
     timestamps, if `available` (needs the `tesseract` binary -- see
     Notes), each with a `prominence_pct`/`prominence_label`
     (title/headline, subtitle/lower-third, or fine-print/caption) derived
     from text height relative to frame height. Skip this section of the
     report if unavailable rather than claiming there's no on-screen text.
   - `color_palette`: dominant colors (hex + share) per sampled frame and
     overall, plus `avg_saturation_pct`/`avg_brightness_pct` -- use this to
     describe the actual grading (warm/cool, vibrant/desaturated, a
     specific recurring palette) with real hex values instead of just an
     eyeballed impression from the frames. The `metadata.video.aspect_ratio`
     / `orientation` / `is_hdr` fields are also worth a line in Overview,
     especially if the user is producing something for a specific platform
     (e.g. vertical/9:16 vs. landscape/16:9).

7. **Write the report.** Use your own judgment on structure for a short
   clip, but for a full deep-analysis request use this shape:

   ```markdown
   ## Overview
   [duration, resolution, aspect ratio/orientation, fps, codec, SDR/HDR,
   one-line read on genre/style]

   ## Transitions & Cuts
   [table or list: timestamp -> transition type (from the script's
   classification) -> confidence -> brief visual note from actually
   looking at the frames per step 4; note any J-cut/L-cut candidates from
   edit_offset as a deliberate editing technique where confidence supports it]

   ## Pacing & Camera Work
   [shot length stats, cuts/minute, how it changes over the runtime --
   read the pacing_curve_per_minute and motion_curve together to describe
   the rhythm: does it speed up, stay steady, breathe at certain points,
   or carry energy through motion within shots rather than cuts? Fold in
   camera_movement here too: is energy coming from cuts, from camera motion
   within shots (pans/zooms), or handheld shake -- and is any of that
   static/locked-off by contrast?]

   ## Sound Design
   [silence/dialogue/music segments, tempo/BPM and cut-to-beat alignment
   if available, loudness spike timestamps as candidate SFX/hits -- be
   clear these are volume-spike candidates you detected numerically, not
   confirmed sound identifications, since you can't actually hear the audio.
   Include loudness_lufs (integrated LUFS/true-peak/LRA) if the user cares
   about mix/delivery levels, not just editorial pacing.]

   ## Voice-Over
   [WPM, pause pattern, notable transcript excerpts, or a clear note that
   no transcript was available and why]

   ## Visual Style & Color
   [what the sampled frames show: framing (close-up/medium/wide mix from
   shot_type_summary), face presence, on-screen text if any (with
   prominence -- title cards vs. lower-thirds vs. captions) -- from actually
   looking at the images plus the faces_summary/on_screen_text data. Include
   the actual color_palette hex values and avg_saturation/avg_brightness to
   describe the grading concretely rather than just impressionistically.]

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
   -- say why if so); OCR can miss stylized or low-contrast text; J-cut/L-cut
   detection is a coarse RMS-jump heuristic, not a real audio-scene-change
   model; camera-movement classification uses approximate timestamp-based
   frame seeking and a small flow-based heuristic, so treat it as a
   reasonable guess per shot, not ground truth; color-palette k-means runs
   on downsampled pixels from the same sparse sample of frames used
   elsewhere, so a brief but strongly-colored moment between samples could
   be missed from the overall palette. None of this is a substitute for a
   font/typography reader, real shot-composition (rule-of-thirds/framing
   beyond close-up-vs-wide) analysis, branding/logo-consistency checks, or
   AI-generation-artifact detection (flicker, hand/anatomy errors, prompt
   drift) -- those still require your own visual judgment from the frames,
   not a number this script can produce.

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
- Color palette, camera-movement, LUFS loudness, edit-offset (J-cut/L-cut),
  shot-framing, and OCR-prominence all reuse ffmpeg/opencv/tesseract/
  pytesseract -- already-required dependencies -- so none of them need a
  new pip package or a session-start hook change; they run by default
  wherever the skill already worked before.
