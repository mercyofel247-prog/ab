# Audio — the premium stack, and how the pipeline mixes + masters it

Fuses the master prompt's Part 10 (audio design) + Part 18 (tier authority) +
**Part 26 (no-audio-generation)** with the 8-video mastering finding
(`lessons-from-8-videos.md` §1, §4, §8). Clips render SILENT — all sound is
designed in the edit. The provided VO is the spine.

## PART 26 — every generated asset renders PICTURE-ONLY (hard rule)
The pipeline's whole audio doctrine assumes each clip/animation is a **silent,
picture-only** asset the VO + score are laid *under*. So every piece you generate
here — HyperFrames animations, the signature-transition bridges, Remotion/Blender
builds — MUST render with a **completely empty audio track**. Never embed an
`<audio>` element, a synthesized voice/TTS of on-screen words, a music sting, a
riser, or any SFX into the render itself. A clip that ships with baked-in sound is
a *silent-corruption* failure: it fights the real narration and the scored bed and
can't be fixed without discarding the take.

- Two meanings of "silent" — don't confuse them: **picture-only** (this rule, true
  of *every* generated asset, always) vs. the **`[SILENT]` dramatic beat** (a ~0.5s
  music-drop *in the mix*, R2 below). A shot tagged `[SILENT]` is still rendered
  with an empty audio track — the tag only tells the mix how to duck the bed there.
- The per-shot `[SFX:…]`/`[MUSIC:…]` fields in the timeline are **edit-stage mix
  instructions** describing what the editor lays *under* the silent clip — never
  something the generation engine synthesizes.
- **Safety net:** `assemble.py`'s `normalize_segment` re-encodes every video
  segment with `-an` (audio dropped), so even a stray baked-in track never reaches
  the mix — but rendering picture-only in the first place is the rule, not the
  fallback (it's wasted render otherwise, and a baked-in TTS voice is exactly the
  hazard this closes).

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
- More S-tier immersion sounds: **downshifter / reverse-swell / pressure-drop**
  (the tonal INVERSE of the riser — pulls a scene DOWN into dread/silence, the
  descent tool that executes the drop-into-quiet), and **sub-rumble /
  camera-shake rumble** (the sustained low shake AFTER an impact boom — the boom
  is the hit, the rumble is the settle).
- **Low beats bright:** sub-bass/booms read premium; wall-to-wall bright
  whooshes on every transition are the #1 amateur tell (reject). Braam
  sparingly (2–3× max, never a bed). No cash-register on money beats — use a
  low boom. Reject comedic stingers / record-scratch / boing outright.

## Matched sound per transition device (Part 18.2b) — mirror the MOVE
Every styled scene-boundary in `transitions.md` carries a ranked, named sound;
draw the transition's `[SFX]` from here. The sound sits in the GAP, stacks with a
List B bed (R1), and yields to the `[SILENT]` vacuum on the biggest boundaries. A
transition sound is **never laid alone** and **never over a stressed `[LAND]`
word** (R0). The whoosh is always LOW and motion-matched — bright over-compressed
whooshes are the reject.

| move / device (`transitions.md`) | matched sound | tier |
|---|---|---|
| push-in / ALERT WASH build-and-land | riser + sub-thud | S |
| SLAM / IMPACT DROP boundary | impact boom + camera-shake rumble | S |
| act-break descent · DIP TO BLACK · BLACK-FIELD DUST DISSOLVE (the TURN/downbeat) | downshift / reverse-swell **into silence** | S |
| WHITE LIGHT-LEAK BLOOM (the default dissolve) | light-leak bloom swell / airy dissolve wash — soft, low, **not** a bright whoosh | S |
| NUMBERED CHAPTER-TITLE CARD (~15–25s music-only) | **scored silence — the SFX layer drops OUT** (authored, not omitted) | S |
| whip / lateral-swish | low matched whip-whoosh + hard pop | A |
| dive | submerge whoosh + pressure hum | A |
| PURE WHITE FLASH CUT | white-flash cut hit (on a music hit) | A |
| BURNING-HOLE / PAPER-BURN REVEAL | paper-burn / fire-edge crackle sweep | A |
| CIRCULAR IRIS / KEYHOLE · PROJECTOR LIGHT-IRIS | iris-close / projector-lamp whoosh (soft mechanical) | A |
| YEAR/DATE CARD · PERSPECTIVE-GRID TUNNEL ZOOM | Doppler rush (toward-camera) — a rush that *arrives* | A |
| THREAD-PULL | taut snap (dry, high-tension) | A |
| TV COLOUR-BARS / SIGNAL-LOST · CRT/VHS (modern era only) | signal-lost static / white-noise burst | B |
| RGB-SPLIT WIPE · NEON-GLITCH CARD | chromatic / digital glitch tear (1–2× per video) | B |

**REJECT sounds** (mirror the visual REJECT list): spiral/spin/vortex whoosh,
spin-riser (the sound partner of the anti-warp visual rejects), notification
swoosh / email whoosh, stock "epic" impacts, bright reverse cymbal, any
preset-library "transition whoosh" pack, and ANY hit landing on a stressed
narration word.

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
