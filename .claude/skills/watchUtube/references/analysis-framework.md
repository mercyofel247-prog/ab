# Deep Video Analysis Framework

The rubric to apply once `analyze_video.py` has produced frames, metrics, and a
transcript. Goal: a analysis precise enough to **re-create or edit a video in the
same style**. Cite real numbers from `analysis.json` and real observations from
the frames — never invent timestamps or metrics.

Tuned for retention-driven documentary/explainer content (MagnatesMedia, Moon,
James Jani, Johnny Harris, Vox), but every axis applies to any video.

---

## 1. Structure & Story Architecture
- **Hook (0–30s):** What is the cold open? A question, a bold claim, a stakes
  statement, a "you won't believe" tease? Note the first on-screen words and the
  first line of VO verbatim. How many seconds until the title/logo?
- **Narrative spine:** Which template — rise-and-fall, mystery/reveal,
  problem→solution, listicle, chronological, "how X really works"?
- **Open loops:** Questions posed early and paid off later (teasing, "but first",
  "we'll come back to this"). List each loop, where opened, where closed.
- **Act breaks & chapters:** Map the segments to timestamps. Note re-hooks at
  each boundary (a fresh tension bump to stop the swipe-away).
- **Payoff & CTA:** How does it land? Subscribe pitch, next-video tease, sponsor
  handoff. Where does the sponsor read sit and how is it bridged?

## 2. Pacing & Rhythm  (use `pacing` in analysis.json + timeline frames)
- **Cuts per minute** and **average shot length.** Documentary-retention style
  usually runs fast: ~20–40 cuts/min, avg shot 1.5–3s; slower cinematic beats
  stretch to 5s+. State the actual numbers and what tempo band they imply.
- **Shot-length distribution:** ratio of <2s / 2–5s / >5s shots. Bursts of very
  short shots = emphasis/energy; long holds = a "let it breathe" beat.
- **Pacing curve:** does cutting accelerate into reveals and slow on emotional or
  data beats? Cross-reference cut timestamps against transcript beats.
- **B-roll density:** how often does the visual change independent of a hard cut
  (push-ins, overlays, cutaways)? Look across the timeline frames.
- **Speech pacing:** words-per-minute of VO (estimate from transcript length ÷
  duration), and how silence/pauses (`silence.gaps`) are used for punctuation.

## 3. Shot & Visual Language  (cut frames + contact sheets)
- **Source mix:** stock/archival footage, screen recordings, motion graphics,
  AI-generated imagery, talking head, animation, maps. Estimate the % split.
- **Composition:** framing, rule-of-thirds, headroom, use of negative space for
  text. Consistent safe-margins?
- **Camera motion faked in post:** Ken Burns push/pull on stills, parallax,
  2.5D/3D camera moves, whip-pan transitions.
- **Color & grade:** dominant palette, contrast, any consistent LUT/teal-orange
  look, vignettes, film grain. Note per-scene color shifts.
- **Aspect ratio & framing:** 16:9 vs cropped cinematic bars; letterboxing used
  as a stylistic beat.

## 4. Transitions  (compare consecutive cut frames)
- Inventory the transition vocabulary: hard cut, J/L cut (audio leads/lags),
  cross-dissolve, dip-to-black/white, whip-pan, zoom/punch-in, morph, match cut,
  masked/graphic wipe, glitch, light leaks.
- Which transition is the "workhorse" (default) vs the "special" one saved for
  act breaks? Estimate frequency of each.
- Are transitions **motivated** (driven by a sound or camera move) or decorative?

## 5. Typography & Motion Graphics  (frames with text)
- **On-screen text style:** font family/weight, case, color, stroke/shadow,
  animated in/out (typewriter, pop, slide, blur-in).
- **Kinetic typography:** are key words punched up in sync with the VO? Emphasis
  color for the "important" word.
- **Lower thirds, labels, chapter cards, statistics callouts, quote cards.**
- **Data viz:** charts, number counters, maps, arrows/highlights. How animated?
- **Brand system:** recurring logo bug, intro/outro cards, consistent accent
  color.

## 6. Sound Design  (loudness.log + silence map + transcript + listen via frames)
- **Music:** genre/mood, tempo, how it swells and ducks under VO. Track changes
  at act breaks. Does a beat-drop align with a reveal or a hard cut?
- **SFX vocabulary:** whooshes on transitions, risers/booms into reveals, ticks,
  clicks, UI blips on text pops, impacts on stats. These are the "glue" of the
  style — note where they land relative to cuts.
- **VO treatment:** dry vs reverbed, EQ (radio-warm), compression, de-essed.
- **Loudness:** integrated LUFS (streaming target ≈ −14 LUFS; note if hotter),
  loudness range (dynamic vs flat/loud), true-peak headroom.
- **Ducking / mix balance:** VO clearly above bed music? Sidechain pumping?
- **Silence as a tool:** strategic full stops before a punchline/reveal
  (`silence.gaps`).

## 7. Voiceover & Script  (transcript.txt)
- **Delivery:** tone, energy, pace, conversational vs authoritative. Accent.
- **Scripting devices:** direct address ("you"), rhetorical questions, cliffhangers,
  pattern interrupts, rule-of-three, callbacks, curiosity gaps, "but here's the
  crazy part" escalators.
- **Sentence rhythm:** short punchy sentences vs long builds. Reading level.
- **Retention hooks in copy:** every ~30–60s is there a fresh hook, stat, or
  tension bump? Map them.

## 8. Retention Engineering (synthesis)
- List every device aimed at keeping the viewer: cold-open hook, open loops,
  re-hooks at act breaks, visual variety cadence, sound-design punctuation,
  pattern interrupts, escalating stakes.
- Estimate where the likely drop-off risks are (long static stretches, a slow
  sponsor read) and how the edit fights them.

## 9. Style Fingerprint (the deliverable summary)
Condense into a reproducible spec:
- cuts/min band + avg shot length
- source-mix percentages
- transition workhorse + accents
- type system (font, accent color, animation)
- SFX/music signature
- VO/loudness targets
- structural template + hook pattern

This fingerprint is what a re-create/edit job is briefed against.

---

### How to read the artifacts
- `analysis.json` — roll-up of all metrics. Cite these numbers.
- `frames/montage/sheet_*.jpg` — whole-video-at-a-glance. Read these FIRST for
  overall look, source mix, color, and how much visual variety there is.
- `frames/cuts/cut_*.jpg` — one full-res frame per detected cut, named with its
  timestamp. Use to inspect composition, text, transitions between shots.
- `frames/timeline/t_*.jpg` — even time-sampled frames for coverage the cut
  frames miss.
- `cuts.json` — every cut timestamp (even beyond the saved frames) for exact
  pacing analysis.
- `loudness.log` — full EBU R128 trace over time.
- `transcript.txt` — timestamped VO for script and pacing analysis.
