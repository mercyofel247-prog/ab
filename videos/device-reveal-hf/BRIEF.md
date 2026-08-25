---
workflow: general-video
flow: automation
storyboard: no
message: "A glowing red device dies as the truth around it comes into focus, revealed against the city it's meant to save."
destination: general
aspect: 1920x1080
language: en
length: 28.5s
angle: footage remix
---

## Intent

A dark, cinematic montage cut from seven pre-shot clips (macro blood drop, a
figure holding a glowing red device, a boardroom of silhouettes, a spotlight
figure, a slow push-in on the device, its light dying, and a city skyline
with a red cross sign). Mystery/thriller tech-health tone. This is a direct
redo of an already-approved ffmpeg edit, ported to a native HyperFrames
composition — the creative decisions (clip order, transition choices, sound
design) are already confirmed; this run executes them, not re-derives them.

## Assets

- assets/c1.mp4 — blood drop macro (scene_1), trim 0-4.0s
- assets/c2.mp4 — figure holding glowing device (SCENE_2), full 6.0s source, split into two placements
- assets/c3.mp4 — boardroom silhouettes (SCENE_3), full 4.0s source, split into two placements
- assets/c4.mp4 — spotlight figure (SCENE_5), trim 0-4.0s
- assets/c5.mp4 — device slow push-in (SCENE_8), trim 0-4.0s
- assets/c6.mp4 — device light dying (SCENE_9), trim 0-4.0s
- assets/c7.mp4 — city skyline + red cross (SCENE_11), trim 0-4.0s
- assets/music_bed.wav — full-length synthesized cinematic score (Am pad -> F-major-add9 reveal)
- assets/sfx_*.wav — synthesized per-cut sound effects (match cut, flash ticks, settle, riser, smash, dissolve whoosh, zoom whoosh)

## Customizations

- Transition per cut, already confirmed with the user:
  1. blood drop -> device holder: match cut (hard cut, no effect)
  2. device holder -> boardroom -> device holder -> boardroom: cross-cut / parallel-edit rhythm (hard cuts)
  3. boardroom -> spotlight figure: fade to black (color dip)
  4. spotlight figure -> device push-in: smash cut (hard cut)
  5. device push-in -> device dying: cross dissolve
  6. device dying -> city reveal: optical zoom (zoom-through)
- Original clip audio is muted throughout; all sound is the synthesized score + SFX on separate audio tracks, ducked under each cut.

## Notes

- Do not re-derive the edit design or ask brief questions again; this file
  and the conversation history are the source of truth.
- Match the ffmpeg reference build's cut points and sound timings as closely
  as the HyperFrames data model allows.
