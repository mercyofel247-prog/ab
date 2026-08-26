# Craft lessons from the 8-video watchutube audit

These are the concrete, measured findings from deep-analysing 8 real
MagnatesMedia-style money-doc videos (six drafts of one Tencent documentary +
two reference pieces: a Standard Oil/Rockefeller cinematic piece and a CNBC
"most valuable companies" piece). They are the empirical half of this skill —
the master prompt supplies the intent, these supply what actually measured
well or badly in finished files. Every rule below is enforced or defaulted
somewhere in the pipeline.

## 1. Mastering — the single biggest, most repeatable win
**Finding:** 7 of the 8 clips were clipping — true peak ABOVE 0 dBTP (+0.04
to +0.28). All six Tencent exports had it baked into the same limiter
ceiling. The one clean file (the Standard Oil piece, −1.32 dBTP) was the only
one mastered correctly. They also all sat at ~−11 LUFS — about 3 dB hotter
than the −14 LUFS streaming target, so they get turned down on playback
anyway, keeping none of the loudness they clipped for.
**Rule:** master every deliverable to **−14 LUFS integrated, true peak ≤ −1.0
dBTP**, two-pass. `assemble.py` does this by default (`meta.master_lufs` /
`master_true_peak_dbtp`). Verify with watchutube's `loudness_lufs` on the
output; a peak over −1.0 is a hard fail.

## 2. Deliver at a real resolution
**Finding:** the Tencent series rendered at non-standard, slightly-squished
sizes (960×538, 852×480) instead of clean 1080p. The two reference pieces
were proper 1920×1080 / 1280×720.
**Rule:** author, render and deliver at **1920×1080 @ 24fps, 16:9** (the
master prompt's global 1080p lock). `assemble.py` normalizes every input to
this peg; upscale to 4K is a manual post step only.

## 3. Transition grammar — match the cut to the content
**Finding:** the fast explainer segments were hard-cut-dominant (up to 19 real
hard cuts/min); the cinematic Standard Oil piece used **zero hard cuts —
every transition a dissolve/wipe/fade** — and read as by far the most
sophisticated edit. Cut speed tracked content, not habit.
**Rule:** pick the transition family by beat energy —
- fast data/list/hype segments → **hard cuts** carry it; save dissolves for section breaks;
- contemplative / historical / emotional beats → **all-dissolve/fade grammar**, held shots up to ~10–30s;
- the **crash-zoom-through-parallax** is the reserved signature for big promise→reality reveals (don't spam it).
Keep transitions **varied** within a chunk (the continuity finding: a single
locked transition type flattens the video). See `transitions.md`.

## 4. Clean out-points: fade-to-black + fade-to-silence together
**Finding:** the well-made reference piece ended on a synchronized
fade-to-black AND fade-to-silence in its final ~1.6s. Cheap-feeling videos cut
audio dead or fade the picture without touching the audio.
**Rule:** end on a `fadeblack` visual transition with the music bed's
`fade_out_s` and the VO tail landing together. Author it into the timeline.

## 5. Beat-sync cuts where the music has a pulse
**Finding:** the tightest-cut draft landed 80% of its cuts on a musical beat —
clearly deliberate and energetic; the slow cinematic piece sat at 50% and was
right to. High beat-alignment reads as intentional ONLY where the track has a
strong pulse.
**Rule:** on driving/tense music segments, place hard cuts on the beat grid
(watchutube's `beat_analysis` gives the grid); don't force it on ambient beds.

## 6. One consistent grade across everything (the continuity layer)
**Finding:** independently-generated shots arrive with different colour
temperature/contrast/saturation and read as "assembled clips" unless graded to
one look. The Tencent series held a genuinely consistent near-black + single
red accent palette across all six exports — good craft worth keeping.
**Rule:** push every segment through ONE shared grade look-block
(`timeline.grade`) — this is the master prompt's Part 15 continuity layer.
Lock the Part 0.5 accent (oxblood OR gold, never both) and author it as an
actual in-scene light, not just a filter.

## 7. Kinetic typography is a signature — but it is NOT a transition
**Finding:** a huge share of apparent "transitions" in the graphics-heavy
Tencent videos were false positives — text typing on, bar charts growing,
icons spinning, a pager screen updating. These are within-shot animations, not
edits. (This is why watchutube now flags low-coverage clustered candidates.)
**Rule:** kinetic type / number reveals / data motion are Mode-B *content*
inside a shot (build them with HyperFrames/Remotion), not cuts between shots.
Don't let them inflate your cut rhythm; the real editorial cut count is much
lower than raw scene-detection suggests.

## 8. J-cuts / L-cuts — let audio lead or trail the picture
**Finding:** the fast pieces showed heavy audio/video edit-offset (audio
frequently changing before/after the visual cut) — a real pro technique when
deliberate.
**Rule:** don't hard-align every audio change to its picture cut. Let the next
scene's sound (or SFX riser) start ~0.1–0.3s BEFORE the visual cut (J-cut) to
pull the viewer forward, or let the outgoing sound trail INTO the new shot
(L-cut) for continuity. Place SFX/music events accordingly in the timeline.

## 9. Framing skews wide/medium — few true close-ups
**Finding:** across all eight, shots were wide/medium-dominant with few tight
close-ups; the face-driven cinematic piece had more but still framed portraits
in-scene rather than as talking-head close-ups.
**Rule:** decide framing per beat deliberately; a genuine close-up is a
punctuation move, not the default.
