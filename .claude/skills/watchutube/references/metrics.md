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

List of `{time, luma_mean}`. Each entry is a frame where ffmpeg's `scene`
score (a normalized measure of how much consecutive frames differ) exceeded
`--cut-threshold`. This is a **candidate scene-change list**, not a verified
transition-type classification -- that's why the skill has you look at the
actual before/after frames (see SKILL.md step 4) rather than trust this
list at face value. `luma_mean` (average brightness 0-255 of that frame) is
a hint: values near 0 suggest the cut lands during a black frame (fade
candidate).

Sensitivity note: fast pans/zooms can produce false positives; very subtle
dissolves can be missed entirely. If the cut count looks obviously wrong
for what the user describes, re-run with an adjusted `--cut-threshold`.

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

Manifest of extracted JPEGs: `{time, tag, file}` (path relative to the
output dir). Tags are either `cut_<t>s_before` / `cut_<t>s_after` (bracket a
specific cut so you can compare the two sides) or `interval_<fraction>`
(evenly spaced samples across the runtime for overall visual-style
coverage). This is the evidence for everything visual you report -- always
look at the actual images via the Read tool rather than inferring from
numbers alone.

## `warnings`

Non-fatal issues encountered during analysis (e.g. a very long video, a
frame extraction that failed at one timestamp). Worth a quick read but
rarely worth surfacing to the user unless one of them explains a gap in the
report (e.g. missing frames around a specific cut).
