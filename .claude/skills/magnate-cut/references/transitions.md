# Transitions — the S-tier set and how the pipeline renders them

Two sources agree and are fused here: the master prompt's Part 14.6 + **14.6.5
EXTENDED TRANSITION LIBRARY** (the MagnatesMedia signature transitions) and the
measured 8-video grammar (`lessons-from-8-videos.md` §3–5). A transition is
authored as `transition_out` on a segment in `timeline.json`.

## The three laws that govern the whole library (14.6.5)
- **LAW 1 — HARD CUT = SAME IDEA; STYLED TRANSITION = NEW IDEA.** Styled
  transitions live ONLY at scene boundaries (new act / time-jump / place /
  argument change). Inside a montage burst or a "same subject, new angle" run:
  **hard cuts only, never a styled transition.** That contrast *is* the rhythm.
- **LAW 2 — INTENSITY RAMPS WITH THE STORY.** Early acts run clean; layer heavier
  treatment (fire, heavy light-leak on nearly every cut) as the subject collapses.
  The back third earns the density (`pacing.md` burst/hold + the era dial).
- **LAW 3 — VARY, DON'T LOCK.** No transition type twice consecutively. The bans
  are jump cuts, flashy-preset spam, and the REJECT list below. A single locked
  transition across a chunk flattens the video (the continuity finding, §3/§5).

Plus the audio rules (`audio.md`):
- **Voice always wins:** a transition's SFX lands in the GAP around the narration,
  never on a stressed word (Part 18 R0).
- **Mirror the move with sound** (Part 10.2 / 18.2b): every S/A device has a
  matched sound — see the table in `audio.md`.

## How each type is produced

| timeline `type` | How the pipeline renders it | When to use |
|---|---|---|
| `hard_cut` | ffmpeg, 1-frame join (reads as a straight cut) | fast data/list/hype beats; the default workhorse of a driving segment. Land it on a beat where the music has a pulse (§5). |
| `dissolve` | ffmpeg `xfade=fade` | soft scene changes; section breaks; the cinematic all-dissolve grammar (§3). |
| `fadeblack` | ffmpeg `xfade=fadeblack` | act breaks; the clean out-point — pair with music `fade_out_s` for the fade-to-black + fade-to-silence ending (§4). |
| `fadewhite` | ffmpeg `xfade=fadewhite` | bright reveals / time jumps; use sparingly (one video over-leaned on it and it read flashy). |
| `wipeleft/right/up/down` | ffmpeg `xfade=wipe*` | directional segment breaks; graphic-driven beats. |
| `smoothleft/right` | ffmpeg `xfade=smooth*` | gentler directional push than a wipe. |
| `whip_pan` | native `smoothleft` approx, OR splice `templates/whip-pan.html` render via `src` | high-energy segment breaks; ~8 frames. The HyperFrames version adds the real directional-blur ramp. |
| `dof_rack` | native `fade` approx, OR splice `templates/dof-rack.html` via `src` | shift attention WITHIN a composite instead of cutting; contemplative. |
| **`crash_zoom`** | splice a pre-rendered `templates/crash-zoom-parallax.html` via `src` | **the signature.** Big reveals, promise→reality hard cuts. ~14 frames / 0.58s. |
| `fly_through` | splice `templates/slow-fly-through.html` via `src` | the contemplative sibling of the crash-zoom; ~40 frames, no blur ramp. |

Native transitions need nothing but the two neighbouring clips. The
HyperFrames signatures (`crash_zoom`, `fly_through`, and optionally
`whip_pan`/`dof_rack`) are their OWN short renders spliced BETWEEN the two
shots — build them first, then point `transition_out.src` at the MP4.

## The crash-zoom recipe (master prompt 14.6.3 — the reference build)
Rendered by `templates/crash-zoom-parallax.html`. The two craft details that
separate premium from preset (14.6.4):
1. **Graph-editor-shaped easing, not defaults** — explicit `cubic-bezier()`
   values (accelerate `cubic-bezier(0.55,0,1,0.45)` into the crash, decelerate
   `cubic-bezier(0.16,1,0.3,1)` onto the land), never a bare `power2.inOut`.
2. **Motion blur ON during the fast phase, ramped in and back out** (0→18px→0)
   and **fully resolved to 0 before the final frame** so shot B lands clean.
   Without the blur ramp a crash-zoom reads as cheap scaling.
Inputs: shot A separated into fg/mid/far parallax planes (reuse the masks from
that shot's build) at Z −200 / −600 / −1400px, and shot B flat at Z −2600px.
ONE axis of motion only (Z); no rotation. Same shared grade + continuous grain
across the cut (§6).

## Rendering a HyperFrames transition (verbatim exec spec, master prompt 14.7)
Transforms only (scale / translateZ / opacity) + CSS `filter: blur()`;
GSAP from its CDN; `window.__timelines["main-video"] = tl` (paused); the root
carries `data-composition-id/width/height/fps/duration`; deterministic (no
`Math.random`/`Date.now`/network in the motion). **Render PICTURE-ONLY** — no
`<audio>`, empty audio track (PART 26; see `audio.md`). Render:
```
npx hyperframes render <projectdir> -c crash-zoom-parallax.html \
    -f 24 -q draft -w auto --gpu --browser-gpu --strict -o renders/crashNN.mp4
```
(GSAP loads from CDN at render time — needs network on the render machine.)

## The extended library (14.6.5) — the full scene-boundary menu, by family

The four templates above are the everyday workhorses; this is the full menu the
measured corpus proved, for boundary VARIETY (LAW 3). Each device is tagged with
its **build engine** and a **tier** (S/A/B/C) inheriting the anti-warp doctrine.
Build the S/A ones you need as short HyperFrames/Remotion picture-only bridges and
splice them via `transition_out.src`; the `[DaVinci …]` ones are ffmpeg
overlay/filter edit-notes, not generation briefs. Reach for the **S** devices
first — they're the corpus backbone.

**B · LIGHT & FLASH** (the corpus's most-used surface)
- **WHITE LIGHT-LEAK BLOOM + DUST** [DaVinci overlay / Remotion alpha · **S**] — the
  DEFAULT dissolve, single most-used device across all 15 films; hides source
  mismatches. ~0.3–0.6s bloom toward near-white, lens-flare streaks, drifting
  motes, Screen mode. **Build-kit priority #1.** Sound: soft airy bloom swell, low
  — *not* a bright whoosh.
- **PURE WHITE FLASH CUT** [DaVinci / Remotion · A] — 1–2 frames of pure white on a
  music hit; sharp impact between two shots. (≈ native `fadewhite`, kept short.)
- **ANAMORPHIC LENS-FLARE STREAK WIPE** [Remotion / DaVinci · B] — horizontal
  blue/gold flare sweeps across; the glossy change.
- **CINEMA-PROJECTOR LIGHT-IRIS** [HyperFrames · A] — projector-lamp cone / light
  iris opens over black; the "let me show you" / archival reveal.
- **SUN-FLARE BLOWOUT** [DaVinci / Remotion · B] — frame blows to warm white through
  a flare on the final clip; the outro "and that's the story" move.

**C · BLACK & NEGATIVE SPACE**
- **DIP TO BLACK** [any · **S**] — fade/fast-cut to black, hold 4–20 frames;
  act-break weight. (≈ native `fadeblack`.)
- **BLACK-FIELD DUST DISSOLVE** [Remotion / DaVinci · **S**] — near-black frame with
  drifting dust + one faint streak, longer hold; the tonal-gravity move for the
  TURN / downbeat (pairs with Part 10 near-silence → the scored `[SILENT]` vacuum).

**D · GEOMETRIC WIPES** (clean transform/mask builds)
- **CIRCULAR IRIS / KEYHOLE MASK** [HyperFrames / Remotion · A] — circle mask
  closes on / opens from a point; focus onto one subject. (Exactly the Shot-08
  iris mechanism — a clip-path circle reveal.)
- **BURNING-HOLE / PAPER-BURN REVEAL** [HyperFrames · A] — black circle burns
  outward through a page, glowing orange edge, next shot underneath; "a document
  exposed." Heavy in exposés (LAW 2).
- **SLICED-PANEL SLIDE + COLOUR WASH** [Remotion · B] — frame breaks into 2–4 angled
  panels that slide off (transform-only); keep the wash accent-locked.
- **DIAGONAL LIGHT-STREAK WIPE** [Remotion / DaVinci · B] — a hard diagonal band of
  light carries the cut.
- **VENETIAN-BLIND / HORIZONTAL-BAR STREAK** [Remotion · B] — light bars sweep,
  motion-blurred; the surveillance "peering in" signal.
- **PERSPECTIVE-GRID TUNNEL ZOOM** [HyperFrames Three.js · A] — fly down a receding
  wireframe corridor, radial blur; time-jump / "down the rabbit hole." A controlled
  single-axis Z-dolly, **never a free spin**.

**E · DIGITAL & SIGNAL** (MODERN era-dial only, `pacing.md` 21.3)
- **TV COLOUR-BARS / SIGNAL-LOST STATIC** [Remotion · B] — SMPTE bars + noise burst;
  the "feed cuts" cold-open / segment marker.
- **RGB VERTICAL COLOUR-BAR STREAK** [Remotion · B] — a vertical smear pulled across;
  fast digital change (transient artefact only, never a held accent).
- **CRT / VHS SCANLINE + DOT-CRAWL** [DaVinci / Remotion · B] — marks a clip as
  archival TV; doubles as a "loses signal" transition.
- **NEON-TEXT CHROMATIC GLITCH CARD** [Remotion / HyperFrames · C] — neon keyword
  type, flicker + RGB fringe; restrained, 1–2× per video.
- **HUD / TARGETING-RETICLE OVERLAY** [Remotion / HyperFrames · B] — brackets +
  crosshair + monospace readout; "being watched."

**F · DATE, NUMBER & CHAPTER CARDS** (the "rush the camera" family)
- **YEAR / DATE CARD** [HyperFrames · A] — big numerals rush toward camera, radial
  blur + RGB split + flare, resolve into the scene; the era-jump marker.
- **MULTIPLIER CARD** [Remotion / HyperFrames · B] — number + "×" + up/down arrows;
  the scale-comparison beat.
- **NUMBERED CHAPTER-TITLE CARD** [HyperFrames / Remotion · **S**] — chapter title in
  serif/condensed caps + "CHAPTER X" + a small pennant, over a scene themed to the
  chapter, **~15–25s MUSIC-ONLY**. The BACKBONE of the longer films. **Build-kit
  priority.** Its defining sound is the SFX layer DROPPING OUT (scored silence).
- **LOGO-IN-A-TUNNEL DIVIDER** [HyperFrames · A] — mark pushed toward camera through
  a dark vignetted tunnel; chapter/act divider (single-axis Z, not a spin).
- **LOGO-FORMATION / PARTICLE-ASSEMBLE** [HyperFrames deterministic particles · A] —
  particles resolve into the logo; "the company coming into being."
- **RECREATED MAGAZINE / ALBUM COVER** [HyperFrames / Claude Design · B] — real
  masthead + subject photo, slight parallax; "they were famous."

**G · COMPOSITE & COLLAGE** (extends the 2.5D parallax core)
- **TORN-POLAROID CARDS ON A CASH BED** [HyperFrames / Claude Design · A]
- **DOUBLE-EXPOSURE PORTRAIT ⇆ GRAPHIC** [DaVinci / Remotion · B] — two layers
  cross-dissolve in Screen; the face never fully leaves.
- **MULTI-POSTER-CARD MONTAGE** [HyperFrames · B] · **FILM-STRIP SPROCKET-HOLE FRAME**
  [Claude Design / DaVinci · B] — "this is old footage."

**H · "READ THE RECEIPTS" — DOCUMENT & SCREEN** (evidence-driven money-doc)
- **SCANNED ARTICLE / COURT-DOC + ANIMATED HIGHLIGHTER** [HyperFrames / Remotion · A]
  — aged-paper scan under a slow push; key phrases underline/highlight ON THE BEAT.
  "This is documented."
- **FORUM / CHAT-LOG SCREENSHOT** [Claude Design / Remotion · B] · **FAKE
  SOCIAL-MEDIA POST W/ CURSOR** [Claude Design / Remotion · B] · **RECREATED VINTAGE
  SOFTWARE UI** [Claude Design / HyperFrames · A] · **RECREATED PERIOD DOCUMENT**
  [Claude Design / HyperFrames · B] · **APP-STORE / PRODUCT-UI COMPOSITE**
  [Claude Design / HyperFrames · B].

**A · BLUR & MOTION**
- **CHROMATIC RGB-SPLIT WIPE** [Remotion · B] — motion blur + heavy red/cyan channel
  offset; the news-soundbite-montage transition. (Radial-zoom, whip and defocus/rack
  are already the core four — don't duplicate.)

**J · BRACKETING FILTERS** (era-dial texture, DaVinci edit-notes) — SUPER-8 /
FILM-GATE GRAIN · CAMCORDER / 80s HOME-VIDEO GRADE · VINTAGE-PRINT PHOTO FRAME ·
KEPT NEWS CHYRON / LOWER-THIRD (an authenticity cue that costs nothing) · BLUE/RED
MONOCHROME CRT-GLOW TENSION FRAME.

**Edit-layer composites (NOT AI-generatable — DaVinci notes only):** fire/flame
overlay wash · smoke/cloud dissolve field · fabric-sheet wipe · chroma-key
interview composite · "filmed off a monitor" wobble · matrix code-rain (C-cap).

## REJECT — never generate these (14.6.5-REJECT, the anti-warp teeth)
The generation engines WARP these; the rejection is deliberate and superior for AI
production. If a beat truly needs the feel, route it to a human After-Effects pass.
- **SPIRAL / VORTEX BLUR** — the #1 AI-warp move.
- **FULL-SPIN BLUR (360°)** · **KALEIDOSCOPE / MIRROR DOUBLING** — warp-prone.
- **BRAND-COLOUR RADIAL BURST (multi-hue)** — breaks the one-accent lock; allowed
  ONLY recoloured to accent + neutral (at which point it's a plain radial burst).
