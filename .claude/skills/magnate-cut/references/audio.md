# Audio — the premium stack, and how the pipeline mixes + masters it

Fuses the master prompt's Part 10 (audio design) + Part 18 (tier authority)
with the 8-video mastering finding (`lessons-from-8-videos.md` §1, §4, §8).
Clips render SILENT — all sound is designed in the edit. The provided VO is the
spine.

## The three governing rules (hard-set, outrank everything)
- **R0 — the voice always wins.** No layer — hit, swell, riser, motif — lands
  ON a stressed narration word. All audio events sit in the GAPS around the
  voice; the bed ducks −15 dB under VO. `assemble.py` enforces the duck with
  real sidechain compression keyed off the VO. Place SFX `at_s` in the gaps.
- **R1 — layering is mandatory.** Every non-silent beat carries BOTH a
  music-bed layer (List B) AND at least one SFX layer (List A). Premium comes
  from the layered stack under the voice, not one sound. Music-only or
  SFX-only leaves half the stack on the table.
- **R2 — silence is a required structural element.** The loudest moment is the
  one right before the hit: drop the bed to a near-zero ~0.5s vacuum before the
  biggest reveal. Author it by leaving a GAP between music beds (and no SFX)
  right before the reveal segment — the pipeline scores the silence for you.

## Music beds (List B / Part 10.1) — `timeline.music[]`
- **Rotate tonal families** — never repeat a family in consecutive chapters;
  span at least four across the video: `serene` · `tense` · `epic` ·
  `uplifting`. Set `family` on each bed.
- Premium tools, in order: evolving low drone / ambient pad → minimalist piano
  underscore → single recurring motif → rising-tension underscore → hybrid
  orchestral-electronic (the money-doc default; scales intimate→epic).
- Ducked under VO (`duck_db`, default −15). Swell at reveals, thin before the
  pre-insert vacuum, drop near-silent at `[SILENT]`.
- Aim **"pensive"/"hopeful", never "sad"/"happy"** — on-the-nose cues
  (mournful cello under crying) are a reject.

## SFX (List A / Part 10.2) — `timeline.sfx[]`
- S-tier (reach first): **sub-bass drone / low-end bed** (the #1 premium SFX,
  felt not heard), **riser/uplifter into a cut** (sync to the payoff),
  **sub-drop / boom / deep impact** (lands a reveal/hard cut/shock stat).
- **Mirror the camera move** (Part 10.2): push-in → riser + sub-thud; whip →
  whoosh + pop; crash-zoom → riser into a sub-drop on the land; TICK-UP →
  counter ticks + snap; STAMP → slam + dust; ALERT WASH → riser + deep sub.
- **Low beats bright:** sub-bass/booms read premium; wall-to-wall bright
  whooshes on every transition are the #1 amateur tell (reject). Braam
  sparingly (2–3× max, never a bed). No cash-register on money beats — use a
  low boom.

## J-cuts / L-cuts (§8) — place events off the picture cut
Don't align every audio change to its visual cut. Start the next scene's sound
or the SFX riser ~0.1–0.3s BEFORE the cut (J-cut, pulls the viewer forward) by
setting the SFX `at_s` slightly before the segment boundary; or let the
outgoing sound trail into the new shot (L-cut) by extending a bed's `end_s`
past the cut.

## Mastering (§1) — done automatically
`assemble.py` runs a two-pass loudnorm to **−14 LUFS integrated, true peak
≤ −1.0 dBTP** (`meta.master_lufs` / `meta.master_true_peak_dbtp`). This is the
fix for the audit's biggest finding (7/8 clipping over 0 dBTP). The clean
out-point (§4) — fade-to-black + fade-to-silence together — is authored by
pairing a final `fadeblack` transition with the last bed's `fade_out_s` and the
VO tail landing together.

## Verify
Run watchutube on the finished MP4 and check `loudness_lufs`: integrated near
−14, true peak at or under −1.0. A peak over −1.0 is a hard fail; re-master.
