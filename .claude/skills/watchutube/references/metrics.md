# manifest.json field reference

Everything the analysis script measures, and how to read it.

## `metadata`

Basic technical facts from `ffprobe`: `duration_sec`, `size_bytes`,
`bit_rate`, and nested `video` (`codec`, `width`, `height`, `fps`,
`nb_frames`, `pix_fmt`) / `audio` (`codec`, `sample_rate`, `channels`).
`has_audio` is `false` for silent/music-bed-only files with no audio stream
at all (rare) -- don't confuse with a video whose audio track exists but is
mostly silence, which shows up in `silence` instead.

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
  catches the transitions `scene_score` structurally can't.

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

## `faces_summary` (and per-frame `faces`)

`{frames_with_face, frames_checked, pct_frames_with_face}`, from running a
face-presence detector (offline Haar cascade, no network needed at
analysis time) over every extracted still in `frames/`. Each entry in the
`frames` array also gets its own `faces` count. Use this for "talking-head
heavy" vs. "b-roll/abstract/product-shot heavy" framing of the visual
style -- it's a presence count, not identity or emotion detection, and it's
only as good as the sample of frames extracted, so treat the percentage as
indicative, not a precise measurement over the full runtime. `null`/absent
if `--skip-faces` was passed or OpenCV was unavailable.

## `on_screen_text`

`{available, reason}` when unavailable (most commonly: the `tesseract`
binary isn't installed on the system -- this is a system package, not
something the script pip-installs, since that needs root; see SKILL.md
Notes for how to add it). When available: `detections`, a list of
`{time, text}` for sampled frames where OCR found readable text (title
cards, lower-thirds, burned-in captions). This only checks the
evenly-spaced `interval_*` frames, not every frame, so a short-lived title
card could be missed if no sample frame happens to land on it -- treat an
empty `detections` list as "no on-screen text found in the sampled frames,"
not a certainty that none exists anywhere in the video.

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

Manifest of extracted JPEGs: `{time, tag, file, faces?, ocr_text?}` (path
relative to the output dir). Tags are either `cut_<t>s_before` /
`cut_<t>s_after` (bracket a specific cut so you can compare the two sides)
or `interval_<fraction>` (evenly spaced samples across the runtime for
overall visual-style coverage). `faces` (face count) and `ocr_text`
(detected on-screen text) are added per-frame when those passes ran and
found something -- see `faces_summary` / `on_screen_text` above for the
aggregate view. This is the evidence for everything visual you report --
always look at the actual images via the Read tool rather than inferring
from numbers alone.

## `timeline.html`

Not part of `manifest.json` -- a sibling file in the output directory (path
also given in the script's stdout JSON as `timeline_html`). A
self-contained, dependency-free HTML/SVG visualization plotting shots/cuts,
motion, loudness (with SFX-candidate markers), brightness, the beat grid,
and voice-over segments on one shared, hoverable timeline -- dark/light
aware, opens in any browser with no server needed. Generated automatically
unless `--skip-advanced` or `--skip-timeline` was passed. Worth mentioning
to the user as a companion to the written report; see SKILL.md step 7 for
how to offer a polished, shareable version via the Artifact tool if wanted.

## `warnings`

Non-fatal issues encountered during analysis (e.g. a very long video, a
frame extraction that failed at one timestamp). Worth a quick read but
rarely worth surfacing to the user unless one of them explains a gap in the
report (e.g. missing frames around a specific cut).
