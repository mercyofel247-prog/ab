# manifest.json field reference

Everything the analysis script measures, and how to read it.

## `metadata`

Basic technical facts from `ffprobe`: `duration_sec`, `size_bytes`,
`bit_rate`, and nested `video` (`codec`, `width`, `height`, `fps`,
`nb_frames`, `pix_fmt`, `aspect_ratio` (e.g. `"16:9"`), `orientation`
(`landscape`/`portrait`/`square`), `color_space`, `color_transfer`,
`color_primaries`, `is_hdr` (`true` if `color_transfer` is a known HDR
transfer function like `smpte2084`/PQ or `arib-std-b67`/HLG, `false` for a
normal SDR transfer, `null` if ffprobe didn't report one at all)) / `audio`
(`codec`, `sample_rate`, `channels`). `has_audio` is `false` for
silent/music-bed-only files with no audio stream at all (rare) -- don't
confuse with a video whose audio track exists but is mostly silence, which
shows up in `silence` instead. `aspect_ratio`/`orientation` are worth a line
in the report when the user's talking about platform fit (e.g. a landscape
16:9 video for a vertical/9:16 platform is a real mismatch worth flagging).

## `platform_metadata`

`{available, platform, title, uploader, channel_follower_count, upload_date,
view_count, like_count, comment_count, average_rating, categories, tags,
description_excerpt}` for a URL source, fetched via `yt-dlp --dump-json`
(the same tool already used to download the video -- no extra dependency,
no OAuth). `{available: false, reason}` for a local file (no platform to
query) or if the fetch failed (network policy, extractor doesn't expose
these fields, etc.). This is **public page metadata only** -- it is not,
and can never become without the video owner's own OAuth-authenticated
Analytics API access, a replacement for CTR, audience-retention graph,
watch time, traffic-source breakdown, subscribers-gained-per-video, or
session data. Say so plainly if the user asks for those specifically.

## `frame_rate_consistency`

`{available, implied_avg_fps, mean_frame_delta_sec, stdev_frame_delta_sec,
coefficient_of_variation, num_long_gaps_over_2.5x_mean,
long_gap_examples_sec, likely_variable_frame_rate}` from real per-frame
`pts_time` values via `ffprobe -show_entries frame=pts_time` -- unlike
`metadata.video.fps` (a single averaged value from the stream header), this
catches actual variable-frame-rate encoding or dropped frames.
`coefficient_of_variation` near 0 means very even frame spacing (true CFR);
a high value or several `long_gap_examples_sec` entries suggests VFR,
dropped frames, or a screen-recording-style source. Cross-check
`num_long_gaps_over_2.5x_mean` against `freeze_frames` before reporting a
gap as a problem -- a legitimate held/freeze-frame shot produces the exact
same signature. `{available: false, reason}` if ffprobe couldn't read
per-frame timestamps.

## `cuts`

List of `{time, luma_mean, detection, transition?}`. Two independent
detectors feed this list, and `detection` says which one found a given
entry:
- `scene_score` -- ffmpeg's `scene` metric spiked past `--cut-threshold`
  on a single frame-to-frame jump. This is how hard cuts get found, but a
  fade or dissolve changes *gradually*, so it structurally never spikes
  this score no matter how the threshold is tuned.
- `frame_diff_scan` -- a dedicated OpenCV pass that scans every decoded
  frame for a *sustained run* of moderately-elevated (not spiking) change,
  which is exactly the signature a fade or dissolve leaves. This is what
  catches the transitions `scene_score` structurally can't -- but it's also
  exactly the signature a small on-screen graphic *animating in place*
  leaves: kinetic-typography text drawing itself on, a bar chart growing,
  an icon spinning, a graphic scrolling. Motion statistics alone can't
  reliably tell "the whole picture changed" from "one element animated in
  an otherwise-static composition" (tested: a spatial-coverage check that
  tried to reject the latter also silently dropped real dissolves on
  dark/stylized footage, since genuine transitions there can have just as
  little pixel-coverage as an animating graphic). So every `frame_diff_scan`
  entry instead carries two diagnostic fields for you to weigh against the
  actual frames, not a number the script filters on:
  - `frame_coverage` -- fraction (0-1) of the frame's pixel area that
    changed at some point across the candidate run. Low coverage is
    *consistent with* a localized animating graphic, but on dark/sparse
    compositions a real cut can also read low -- it's a hint, not proof.
  - `nearby_soft_candidates` -- how many *other* `frame_diff_scan`
    candidates fall within 2.5s of this one. A tight cluster of several
    (e.g. 3+) is the strongest signal here: real edits are rarely stacked
    that densely, so a cluster usually means "one continuous on-screen
    animation is registering as multiple separate candidates," not several
    genuine cuts in a couple seconds. A cluster of exactly 2 is much
    weaker evidence -- back-to-back real transitions (a wipe immediately
    followed by a dissolve, say) are common enough in fast-paced editing
    that a pair alone shouldn't be treated as suspicious.
  When you see a `frame_diff_scan` cut with low `frame_coverage` *and* a
  nonzero `nearby_soft_candidates`, look at its before/after frames
  specifically for whether the overall composition/background is the same
  in both with just a foreground element further along in an animation --
  if so, say plainly in the report that it's likely an animated graphic
  reveal, not an edit point, rather than reporting it as a cut. Don't
  reject a candidate on the numbers alone without checking the frames.

Unless `--skip-advanced` was passed, each entry also gets a `transition`
sub-object: `{type, confidence, detail}`, computed by extracting a short
burst of frames straddling that exact timestamp and analyzing frame-to-frame
diff, luma extremes, and left/right-half diff asymmetry. `type` is one of
`hard_cut`, `fade_to/from_black`, `fade_to/from_white`, `dissolve/cross_fade`,
or `wipe_candidate` (or `unknown` if the burst extraction failed for that
timestamp). `confidence` is 0-1 -- treat anything under ~0.5, and any
`wipe_candidate` result (the weakest heuristic here, based on which half of
the frame changes first), as needing a visual look at the actual frames
before you report it as fact. `detail` carries the raw numbers
(`max_frame_diff`, `median_frame_diff`, `elevated_frame_pairs`,
`min_luma_in_window`, `max_luma_in_window`, `left_right_onset_gap_frames`)
for transparency, not for you to re-derive conclusions from -- the `type`
field already did that.

Validated against synthetic test clips with known ground truth (hard cuts,
a fade-to-black, and a cross-dissolve, each at known timestamps) plus a
real project render -- both detectors and the classifier landed on the
correct timestamps and types in testing. That's confidence in the
*mechanism*, not a guarantee on every real-world video: fast pans/zooms can
still produce a `scene_score` false positive, and an extremely subtle or
unusually-lit dissolve could confuse the burst classifier. If the cut count
or classifications look obviously wrong for what the user describes,
re-run with an adjusted `--cut-threshold`, or just say what you see in the
frames instead of trusting the label.

Classified cuts (same subset as `transition`, and only when the video has
audio) also get an `edit_offset` sub-object: `{type, confidence, detail}`.
`type` is `aligned_cut` (audio and video change together -- the normal
case), `j_cut_candidate` (the biggest local audio RMS jump happens
measurably *before* the video cut -- the next scene's sound is already
audible before you see it), `l_cut_candidate` (the jump happens measurably
*after* -- the previous scene's audio trails into the new shot),
`no_clear_audio_transition` (audio around this cut didn't shift enough to
say anything -- not proof there's no edit trick, just no signal at this
resolution), or `unknown` (extraction/measurement failed). `detail` carries
`max_jump_db` and `audio_jump_offset_from_cut_sec` (negative = before the
cut, positive = after). This is a coarse RMS-level-jump heuristic on ~50ms
windows, not a real audio-scene-change model -- a genuine signal for
calling out deliberate J-cut/L-cut editing, but don't overstate precision
on a borderline `confidence`.

Classified cuts with both a `cut_<t>s_before` and `cut_<t>s_after` frame
extracted (see `frames`) also get a `scene_similarity` sub-object:
`{color_histogram_correlation, likely_read, note}`.
`color_histogram_correlation` (-1 to 1, via `cv2.compareHist` with
`HISTCMP_CORREL` on 8x8x8-bin BGR histograms) measures how similar the two
frames' overall color distributions are. `likely_read` buckets it: above
0.75 is `"same-scene continuation (jump-cut-like, small change)"`, below
0.35 is `"different scene/location (full cut/cutaway-like)"`, otherwise
`"ambiguous"`. This is a coarse pixel-statistics proxy, not real shot/
continuity understanding -- a same-location cut under a big lighting change
can read as low, and two differently-lit-but-similarly-colored scenes can
read as high. Absent if either frame wasn't extracted (e.g. deduped against
a nearby `interval_*` frame on a short/sparse-sample video) or OpenCV was
unavailable.

## `pacing`

Derived from `cuts` + `metadata.duration_sec`:
- `num_shots` / `num_cuts` -- shots = cuts + 1.
- `cuts_per_minute` -- a single-number pacing summary. Rough feel: under
  ~10/min reads as slow/deliberate, ~10-25/min is typical narrative pacing,
  30+/min is fast-cut/energetic (music videos, hype reels).
- `shot_length_stats` -- min/max/mean/median/stdev of shot durations in
  seconds. High stdev means pacing varies a lot (e.g. long establishing
  shots mixed with quick cutaways) rather than being uniform.
- `pacing_curve_per_minute` -- cut count bucketed by minute of runtime, in
  order. Use this to describe how the edit's rhythm changes over time (e.g.
  "opens slow, accelerates into the final third").

## `camera_movement`

List of `{shot_start, shot_end, movement: {type, confidence, detail}}` for
a sampled subset of shots (up to `--max-classified-shots`, evenly spread
across the whole shot list -- not necessarily every shot). `type` is one of
`static`, `pan/tilt`, `zoom_in`, `zoom_out`, or `handheld/shake`, derived
from dense optical flow (Farneback) between a few frames sampled within the
shot: overall flow magnitude separates static from moving, a strong radial
component (flow pointing outward/inward from frame center) signals zoom,
a large consistent mean flow vector signals pan/tilt, and high
frame-to-frame direction variance at non-trivial magnitude signals
handheld/shake. `detail` carries the raw flow numbers
(`mean_flow_magnitude`, `mean_translation_magnitude`, `mean_radial_flow`,
`direction_angle_stdev`, `samples`) for transparency. This is what tells
you *what kind* of camera movement is driving a shot's `motion_curve`
energy (or confirms a shot is genuinely locked-off) -- `motion_curve` alone
can't distinguish a pan from a zoom from handheld shake, all of which can
produce similar magnitude. Treat `confidence` as a rough heuristic signal,
not ground truth: frame seeking here is timestamp-based (`cv2`
`CAP_PROP_POS_MSEC`), which is approximate on long-GOP-encoded video, so
very short shots or shots right after a hard cut can be classified from
slightly-off frames. `null`/absent if `--skip-camera-movement` was passed
or OpenCV was unavailable.

## `silence`

List of `{start, end, duration}` from ffmpeg's `silencedetect` (threshold
-30dB, min 0.3s by default). Gaps NOT in this list are where there's audio
content -- dialogue, music, or SFX indiscriminately (silencedetect can't
tell them apart; that's what `loudness_curve` and the transcript are for).

## `black_frames` / `freeze_frames`

`black_frames`: sustained near-black video segments (`blackdetect`) --
useful for confirming a fade-to-black transition guess from `cuts`, or
spotting title-card/interstitial segments.

`freeze_frames`: segments where the video content doesn't change
(`freezedetect`) -- genuine held/freeze-frame shots, or an artifact if the
source had dropped frames. A freeze that lines up with a cut timestamp
often means "hold on last frame, then cut" as a stylistic beat.

## `loudness_curve` / `loudness_spikes_candidate_sfx`

`loudness_curve`: RMS loudness in dB, sampled in ~1-second windows
(`rms_db: null` means that window was digital silence). This is the closest
thing to a volume-over-time graph you have without being able to listen.

`loudness_spikes_candidate_sfx`: windows where RMS jumps >=10dB above the
local rolling median -- i.e. a sudden loud moment against what came just
before. These are **candidates**: an impact/whoosh/stinger sound effect, a
music drop, or a shout are all consistent with a spike. Cross-reference the
timestamp against `cuts` (impact SFX often land exactly on a cut) and the
nearest sampled frame before reporting it as a likely SFX moment. Never
claim to have identified *what* the sound is -- you can't hear it.

## `loudness_lufs`

`{available, integrated_lufs, loudness_range_lu, true_peak_dbtp,
threshold_lufs}` from a single-pass ffmpeg `loudnorm` measurement -- the
actual integrated loudness (LUFS), true peak (dBTP), and loudness range
(LU) used for real broadcast/streaming delivery specs (e.g. YouTube/most
streaming platforms target roughly -14 LUFS integrated; broadcast specs
often target -23 or -24 LUFS). This is a single summary number for the
whole file, unlike `loudness_curve`'s per-second relative RMS -- use
`loudness_lufs` when the question is "is this mixed to spec," and
`loudness_curve`/`loudness_spikes_candidate_sfx` when the question is
"where does the volume change over time." `{available: false, reason}` if
there's no audio track or `loudnorm` didn't report measurements (e.g. a
clip too short or fully silent).

## `av_sync_drift_summary`

`{available, num_cuts_sampled, mean_offset_sec, stdev_offset_sec,
likely_systematic_av_drift, note}` -- aggregates every classified cut's
`edit_offset.detail.audio_jump_offset_from_cut_sec` reading into one
whole-file signal, distinct from any single cut's J-cut/L-cut call.
`likely_systematic_av_drift: true` (a consistent nonzero `mean_offset_sec`
with LOW `stdev_offset_sec` across many cuts) points at a real mux/encode
sync bug -- audio and video genuinely out of sync throughout the file. A
high `stdev_offset_sec` with offsets scattered in both directions is what
normal editorial J-cut/L-cut usage looks like in aggregate (a deliberate
technique, not a sync bug) -- don't conflate the two. Same coarse RMS-jump
heuristic underneath as `edit_offset`, so treat it accordingly, not as a
frame-accurate sync measurement. `{available: false, reason}` if fewer than
3 cuts got a usable audio-offset reading.

## `exposure`

`{available, avg_shadow_clip_pct, avg_highlight_clip_pct,
avg_contrast_range_0_255, per_frame, note}` -- per sampled `interval_*`
frame (and averaged), the percentage of pixels crushed near-black (luma
<=5) or blown near-white (luma >=250), plus `contrast_range_0_255` (5th-
95th percentile luma spread, a visual dynamic-range proxy). A luma-
histogram heuristic on the sparse sampled-frame set, not a waveform/
vectorscope-grade trace of the whole timeline, and it says nothing about
*why* a frame is clipped (deliberate high-key/low-key look vs. an actual
exposure mistake) -- weigh it against the actual frame before calling it a
flaw. `{available: false, reason}` if OpenCV was unavailable or
`--skip-exposure` was passed.

## `sharpness_noise`

`{available, avg_sharpness_laplacian_var, per_frame, read_guide}` -- a
focus/blur proxy per sampled frame via Laplacian variance (crisp edges =
high variance, soft/out-of-focus/heavily-denoised = low). Rough feel only
(see `read_guide` in the field for thresholds), varies hugely by content/
resolution/detail level -- always sanity-check against the actual frame.
Not a true signal-to-noise-ratio measurement (that needs a clean reference
signal a single frame can't provide). `{available: false, reason}` if
OpenCV was unavailable or `--skip-sharpness` was passed.

## `compression_artifacts`

`{available, avg_block_edge_ratio, read_guide, note}` -- a coarse
blockiness estimate: DCT-block-based codecs encode in 8x8-aligned blocks,
and heavy compression tends to leave faint edges at those boundaries. This
compares mean horizontal-gradient energy at 8-pixel-aligned columns vs.
non-aligned columns across the sampled frames. ~1.0 means no detectable
block edges above the surrounding gradient; notably above ~1.15 suggests
visible blocking. No ringing/mosquito-noise detection, no bitrate-ladder
awareness, and it can't distinguish deliberate stylized noise/grain from
real compression damage -- a rough hint, confirm against the actual frames.
`{available: false, reason}` if OpenCV was unavailable or
`--skip-compression-check` was passed.

## `composition`

`{available, per_frame, pct_frames_closer_to_thirds_than_center, note}` --
a rule-of-thirds proxy per sampled frame. Finds an "interest point" (the
detected face center from `frames[].largest_face_center_pct` when
available, otherwise the centroid of strong Sobel edge energy) and reports
its distance to the nearest rule-of-thirds intersection vs. to dead-center,
both as a percentage of the frame diagonal. This is a cheap geometric
heuristic, NOT real composition analysis -- no leading-lines, headroom, or
framing-intent understanding, and the edge-energy fallback can land on
background clutter rather than the real subject on busy or faceless
(product/landscape) shots. Use it to flag a tendency toward
centered/flat framing vs. off-center/thirds-leaning framing, always
verified by actually looking at the frame. `{available: false, reason}` if
OpenCV was unavailable or `--skip-composition` was passed.

## `brightness_curve`

Average luma (0-255) sampled at 1fps across the whole video. Use it to
describe overall visual tone (consistently dark/moody vs. bright, or a
mid-video shift), and to sanity-check fade guesses (a dip toward 0 right
at a cut timestamp corroborates a fade-to-black read).

## `motion_curve`

List of `{time, motion}` (0-100), sampled ~3x/second via frame-to-frame
grayscale diff over the *whole* video -- independent of `cuts` entirely.
This is what catches energy *within* a single unbroken shot: a handheld pan,
a zoom, an action sequence, or conversely a locked-off static shot (motion
near 0 throughout). Read this alongside `pacing` -- a video can be
low-cuts-per-minute but still feel energetic if motion stays high, or
high-cuts-per-minute but feel static if each shot itself barely moves.

## `faces_summary` / `shot_type_summary` (and per-frame `faces`, `shot_type_guess`)

`faces_summary`: `{frames_with_face, frames_checked, pct_frames_with_face,
style_guess, note}`, from running a face-presence detector (offline Haar
cascade, no network needed at analysis time) over every extracted still in
`frames/`. Each entry in the `frames` array also gets its own `faces`
count. `style_guess` is a coarse label from `pct_frames_with_face`:
`"talking-head-heavy"` (>=60%), `"b-roll/abstract-heavy"` (<=20%), or
`"mixed"` -- a whole-video summary label, not a scene-by-scene breakdown.
Use this for "talking-head heavy" vs. "b-roll/abstract/product-shot heavy"
framing of the visual style -- it's a presence count, not identity or
emotion detection, and it's only as good as the sample of frames
extracted, so treat the percentage as indicative, not a precise
measurement over the full runtime. `null`/absent if `--skip-faces` was
passed or OpenCV was unavailable.

When a frame has a detected face, it also gets `largest_face_frame_area_pct`
(the biggest face's bounding-box area as a percentage of the frame),
`largest_face_center_pct` (`[x_pct, y_pct]` of that face's center -- used
as the "interest point" for the `composition` rule-of-thirds proxy when
present), and a derived `shot_type_guess`: `close-up` (>15%), `medium`
(4-15%), or `wide` (<4%). `shot_type_summary` is the aggregate count of
each across all frames with a detected face. This is a cheap, face-size-based proxy for
real shot-type/composition classification -- it only applies to frames
where a face was actually found, says nothing about framing on
faceless/product/landscape shots, and a face far off-center or a
group shot can skew the "largest face" reading; treat it as a rough
framing signal to fold in with what you see in the actual frames; not a
substitute for a real composition read (rule-of-thirds, headroom, camera
angle) -- see `composition` below for the (also coarse) geometric proxy
that goes one step further.

## `on_screen_text`

`{available, reason}` when unavailable (most commonly: the `tesseract`
binary isn't installed on the system -- this is a system package, not
something the script pip-installs, since that needs root; see SKILL.md
Notes for how to add it). When available: `detections`, a list of
`{time, text, prominence_pct?, prominence_label?, text_luma?,
background_luma?, luma_contrast_0_255?, readability_label?}` for sampled
frames where OCR found readable text (title cards, lower-thirds, burned-in
captions), plus a top-level `readability_note`. `prominence_pct` is the
tallest confident word's height as a percentage of frame height;
`prominence_label` buckets it as `title/headline` (>=8%),
`subtitle/lower-third` (3-8%), or `fine-print/caption` (<3%) -- a cheap
stand-in for real typography/font analysis (weight, face, kerning aren't
measured, just size). `luma_contrast_0_255` is the luma difference between
that same tallest word's bounding box and a padded ring around it;
`readability_label` buckets it as `"high contrast/likely readable"`
(>=80), `"medium contrast"` (>=30), or `"low contrast/may be hard to
read"` (<30) -- a coarse text-vs-background luma proxy, NOT a real WCAG
contrast-ratio formula and not aware of hue (equally-bright but
differently-hued text/background can read as low contrast here while
still being legible to a viewer). This only checks the evenly-spaced
`interval_*` frames, not every frame, so a short-lived title card could be
missed if no sample frame happens to land on it -- treat an empty
`detections` list as "no on-screen text found in the sampled frames," not
a certainty that none exists anywhere in the video.

## `beat_analysis`

`{available, tempo_bpm, num_beats, beat_times, cuts_on_beat, cuts_on_beat_pct, tolerance_sec}`
when available (via `librosa`), or `{available: false, reason}` otherwise
(no audio, librosa unavailable, or detection failed on unusual audio).
`tempo_bpm` is the estimated overall tempo; `cuts_on_beat_pct` is the
percentage of entries in `cuts` that fall within `tolerance_sec` (0.15s by
default) of a detected beat -- a genuine "is this edited to the music"
signal. High alignment (call it roughly 60%+ for a short clip) is worth
noting as a deliberate editorial choice on a music-driven edit; low
alignment isn't necessarily a flaw -- plenty of well-edited video (dialogue
scenes, narrative pacing) has no reason to cut on a beat at all, and tempo
estimation itself is less meaningful on audio without a clear rhythmic
pulse (ambient beds, pure dialogue). Don't over-read this metric on content
where it doesn't apply.

## `color_palette`

`{available, overall_palette, avg_saturation_pct, avg_brightness_pct,
white_balance_estimate, per_frame}` when available (needs OpenCV), or
`{available: false, reason}` otherwise. `overall_palette` and each
`per_frame` entry's `palette` are lists of `{hex, pct}` -- dominant colors
from k-means clustering over downsampled pixels (of the same `interval_*`
sample frames used elsewhere), ranked by share of sampled pixels.
`avg_saturation_pct`/`avg_brightness_pct` give a quick numeric read on
"vibrant vs. desaturated" and "bright vs. dark" grading overall. Use the
actual hex values when describing a video's color grade instead of an
eyeballed impression -- e.g. "the palette centers on `#3a1f1f` and
`#c94f4f`, a desaturated red/black grade" is concrete in a way "looks
reddish and dark" isn't. `white_balance_estimate` is
`{avg_r, avg_g, avg_b, warmth_score, label, note}` -- a channel-mean-ratio
proxy for warm/cool color-temperature bias (`label` is `"warm (amber/red-
leaning)"`, `"cool (blue-leaning)"`, or `"neutral"`), NOT a measured Kelvin
value or a substitute for a real white-balance reading off a reference
card -- a genuinely warm-lit scene (e.g. a sunset) reads "warm" here
whether or not the camera's white balance was actually set correctly. This
is all computed on the same sparse frame sample used for visual
inspection, so a strongly-colored moment that falls between samples (e.g.
a one-frame flash of color) won't show up in the overall palette -- treat
it as representative of the dominant look, not exhaustive. `null`/absent
if `--skip-color` was passed.

## `transcript`

`{available, reason}` when unavailable (no audio track, faster-whisper
couldn't be installed, or -- commonly in restricted-network sessions -- the
model weights couldn't be downloaded from huggingface.co because of egress
policy). When available: `segments` (each `{start, end, text}`), `full_text`,
`total_words`, `speech_duration_sec`, `words_per_minute`, and `pauses`
(gaps >=0.5s between segments, with the timestamp they start after).

WPM context: conversational voice-over typically runs 130-160 WPM;
under ~110 reads as slow/deliberate, over ~180 reads as rushed/energetic.
Treat this as a rough guide, not a hard rule -- content type matters (a
meditative piece and a hype trailer have very different "correct" pacing).

## `frames`

Manifest of extracted JPEGs: `{time, tag, file, faces?,
largest_face_frame_area_pct?, largest_face_center_pct?, shot_type_guess?,
ocr_text?}` (path relative to the output dir). Tags are either `cut_<t>s_before` / `cut_<t>s_after`
(bracket a specific cut so you can compare the two sides) or
`interval_<fraction>` (evenly spaced samples across the runtime for overall
visual-style coverage). `faces`/`shot_type_guess` and `ocr_text` are added
per-frame when those passes ran and found something -- see `faces_summary`
/ `shot_type_summary` / `on_screen_text` above for the aggregate views.
This is the evidence for everything visual you report -- always look at
the actual images via the Read tool rather than inferring from numbers
alone.

## `timeline.html`

Not part of `manifest.json` -- a sibling file in the output directory (path
also given in the script's stdout JSON as `timeline_html`). A
self-contained, dependency-free HTML/SVG visualization plotting shots/cuts,
motion, loudness (with SFX-candidate markers), brightness, a color-palette
swatch strip, the beat grid, and voice-over segments on one shared,
hoverable timeline -- dark/light aware, opens in any browser with no server
needed. Generated automatically unless `--skip-advanced` or
`--skip-timeline` was passed. Worth mentioning to the user as a companion
to the written report; see SKILL.md step 7 for how to offer a polished,
shareable version via the Artifact tool if wanted.

## `warnings`

Non-fatal issues encountered during analysis (e.g. a very long video, a
frame extraction that failed at one timestamp). Worth a quick read but
rarely worth surfacing to the user unless one of them explains a gap in the
report (e.g. missing frames around a specific cut).
