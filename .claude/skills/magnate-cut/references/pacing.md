# Pacing — cut-rate bands, burst-vs-hold, and the era dial

Fuses the master prompt's **Part 21** (cut-pace & era dial) + **Part 20**
(archetypes) with the Playbook's measured per-archetype figures. Cutting rate is
not "fast" or "slow" — it is a **band** with deliberate **contrast inside it**, set
by the archetype and tuned by the subject's era. This governs how you space
segment durations when refining `timeline.json`, and it's a checkable QC target
(watchutube reports cuts/min and the beat grid).

## The bands (average cuts/min across a chunk — NEVER a fixed interval)
| band | cuts/min | who lives here (measured corpus) |
|---|---|---|
| A · SLOW | 8–11 | ONLY the chart/explanation-heavy Explainer, where long holds on rising line-graphs carry the beat (Netflix 8.3, slowest measured). |
| B · MEDIUM | 11–15 | the workhorse: Founder-bio, Industrialist, Brand-history, Exposé investigative middle, story/mid Explainer (Louis Vuitton 11.4, Nike 14.4, Rockefeller 11.6). |
| D · FAST | 16–25 | MODERN Heist with real footage (Jho Low 24.6, Silk Road 16.4), fast profile-Explainer (Son 18.3), Exposé REVEAL spikes. |

**Archetype → range** (era selects the point within): Founder-bio 11–15 ·
Industrialist 11–13 · Brand-history 11–13 · Exposé 11–20 (B middle, D reveals) ·
Heist 11–25 (PERIOD ~11 → MODERN ~17–25, the widest span) · Explainer 8–18.

Bands **overlap by design** — the number is an average, not a target every minute
must hit. An Exposé lives at B and SPIKES to D on reveals; a period Heist sits at B
while a modern one lives at D. That spread is correct, not a violation.

## Burst-vs-hold contrast is MANDATORY (even-paced cutting is a hard fail)
Every chunk must contain BOTH poles — the contrast *between* them is the pacing:
- **BURSTS** — sub-second cuts on lists, montages, escalation ladders, evidence
  stacks (the Playbook: *20–40 cuts in 2–3 seconds is normal* on a title/luxury/
  scandal montage).
- **HOLDS** — 10–60s sustained frames on the big explanation, the big reveal, and
  THE DOWNBEAT (the human-cost breather is always a hold). The hold is where the
  punch-word-last land breathes. Wordless MUSIC interludes (15–25s at the title
  sting and every chapter divider) are the ear's version of a hold.

A chunk that cuts evenly throughout — even at a *correct average* — fails.

## The era dial (a band-SETTER, orthogonal to the accent)
Era can move the same archetype a FULL BAND (period Ponzi 10.9 vs modern Jho Low
24.6 — 2.3× apart). Weight era at least equally with archetype when fixing the
average:
- **PERIOD** (pre-~1990, reconstructed): sepia / film-grain / archival-flicker
  texture; sits at the LOWER end of its range.
- **MODERN with real news/phone footage:** digital / signal / screen-capture / HUD
  texture; sits at the UPPER end (real footage is an accelerant — it invites fast
  intercutting).
- **MODERN but still reconstructed:** mid-range.

The era dial moves **band position + grade texture + cut rate** (it drives which
`transitions.md · E · DIGITAL & SIGNAL` and `J · BRACKETING` devices are even
allowed). It **never touches the Part 0.5 accent** — a story spanning 1910→2010
shifts grade/texture/pace across its acts but keeps ONE accent throughout.

**Runtime does not lower the band.** A 40-min feature is not licensed to crawl
(Netflix 69min@8.3 vs Tencent 79min@17.1 — archetype-and-era set the rate, not
length). A feature earns its length through more chapters and more holds, not a
slower average.

## Applying it here
- When refining `timeline.json` segment durations (or setting `--beat-len` /
  `beats.csv` `dur`), target the archetype+era average as a *chunk average* and
  deliberately alternate short burst runs with long holds — don't lay every clip
  at the same length.
- **QC (watchutube):** the reported cuts/min should sit in the archetype+era band
  *on average*, with a visible burst/hold spread (not a flat rate); on driving/tense
  music, hard cuts land on the beat grid (`lessons-from-8-videos.md` §5); the
  crash-zoom signature is present but not spammed.
