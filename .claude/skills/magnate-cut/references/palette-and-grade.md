# Palette & grade — the one look that makes it feel like ONE channel

Fuses the master prompt's **Part 0.5** (topic-driven palette selection) and **Part
15** (continuity layer) with the Playbook's **"The grade"** section. Two separate
things stack here and must not be confused:

- the **BASE GRADE** — the warm-amber cinematic look pushed across *every* shot
  for continuity (the Playbook's measured house look);
- the **ACCENT** — ONE colour (oxblood *or* gold) chosen by the story's arc,
  authored *into* each shot on top of the base grade, used sparingly.

`build_timeline.py` writes both into `timeline.json`; `assemble.py`'s
`grade_filter` applies the base grade to every segment. Lock them before the
first cut — they govern the whole video.

## 1. Choose the ACCENT by STORY ARC (Part 0.5) — not by vibe

The selection rule is: **does the video END on triumph/scale/success, or on
collapse/loss/reckoning?** A story that BEGINS rich but FALLS is a *fall* story
(NEOM begins as "richest ambition" but its through-line is the collapse → Track 2).

| | TRACK 1 — RISE / WEALTH / TYCOON | TRACK 2 — FALL / SCANDAL / EXPOSÉ |
|---|---|---|
| use when | ends in triumph / scale / "look what they built" | ends in collapse / reckoning / "it all fell apart" |
| ground | `#0B0B0C` near-black | `#0B0B0C` near-black |
| **accent** | **deep gold `#C9A24B`** | **deep oxblood `#7A160E`** |
| secondary | navy `#1B2A3A` (institutional trust) | graphite/ash `#3A3A3E` (decay) |
| type | warm bone `#EDE8DD` | warm bone `#EDE8DD` |
| label | grey `#8A8F98` | grey `#8A8F98` |
| `--palette` | `gold` | `oxblood` |

**Hard discipline (breaking it looks cheap):**
- **ONE accent per video.** Never run gold and oxblood/red as co-accents — black +
  bright-red + gold together reads as a *casino menu*, not premium.
- The anchor (near-black), type (warm bone), grain/vignette logic and the whole
  grammar stay **identical across both tracks** — that constancy is what makes it
  feel like one channel with two moods, not two channels.
- Bright lit-red `#D62E1F` is a per-video OVERRIDE for one alarm beat only (push
  the oxblood to its hottest end on THAT beat) — never the channel identity.

**Accent-in-scene (Part 0.5 hard rule):** the accent must be PRESENT IN THE FRAME
as an actual light or material — a key/rim/edge light on the hero subject, or the
emissive glow/rim on Mode-B hero type — not merely inherited from the grade. The
grade guarantees the *look*; the accent must be *authored into the shot*. Never
flooded: presence, not saturation.

## 2. The BASE GRADE — the house look across everything (Playbook "The grade")

> One look across everything: warm amber / tungsten highlights, teal-leaning
> shadows, a heavy dark vignette, visible film grain. Every source — movie clip,
> stock, AI image, news, animation — is regraded to sit in it.

This is the continuity layer (Part 15): independently-generated shots arrive at
different colour temperature/contrast/saturation and read as "assembled clips"
unless pushed through ONE grade. Encoded in the `timeline.grade` block:

```json
"grade": {
  "lut": null,
  "eq": { "contrast": 1.06, "brightness": -0.01, "saturation": 0.92, "gamma": 1.02 },
  "colorbalance": {
    "shadows":    [-0.06, -0.01, 0.07],
    "midtones":   [0.02, 0.0, -0.02],
    "highlights": [0.08, 0.02, -0.08]
  },
  "vignette": 0.5,
  "grain": 4
}
```
- **`eq`** — exposure/contrast/saturation (slightly crushed, slightly desaturated).
- **`colorbalance`** — the split-tone: `[red, green, blue]` per tonal range,
  −1..1, kept subtle (|v| ≤ ~0.12). Teal-leaning **shadows** (blue up, red down);
  warm-amber **highlights** (red up, blue down). This is the whole house look.
- **`vignette`** — ffmpeg vignette *angle* in radians; **smaller = darker
  corners**. House default `0.5` (heavier than ffmpeg's ~0.628). `true` = default;
  omit / `0` to disable.
- **`grain`** — moving film grain amount (ffmpeg `noise`), on top.
- **`lut`** — optional `.cube` for a bespoke look; runs after `colorbalance`. Use a
  LUT only when you actually have one; the `eq`+`colorbalance`+`vignette` stack is
  the default and needs no external file.

A LUT'd or era-specific override still keeps the accent lock. Per the era dial
(`pacing.md`), a film spanning decades may shift grade/texture across its acts
(sepia period → digital modern) while keeping ONE accent throughout.

## 3. Per-segment control
- `"grade": true` (default) pushes the base grade onto a segment; `"grade":
  false` exempts one shot (e.g. a deliberately raw insert, or an overlay-only
  plate). The accent-in-scene rule still applies to what the shot *shows*.
- Subject-specific identity layers (the Playbook notes the Tencent film pushing
  its gaming section to an electric-blue glitch) are a *per-chapter* grade tweak
  on top of the base look, never a second channel-wide accent.

## Verify (watchutube)
`color_palette` should read consistent across the runtime (continuity holding),
with the chosen accent present and the off-accent colour absent. A shot that reads
as an odd-one-out in temperature/contrast failed the grade — re-check its segment.
