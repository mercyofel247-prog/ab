---
name: website-to-video
description: Turn a live marketing/product website into a premium, Apple-keynote-style product-launch or reveal video -- capturing the site's REAL colors, typography, UI feel, and copy (never invented branding) and building it into a HyperFrames-rendered video with real voiceover (Kokoro TTS via `hyperframes tts`) and deterministic sound design. Use this whenever the user asks to turn a website/landing page/SaaS product/app into a promo, launch, reveal, teaser, or announcement video, asks for an "Apple-style" or "keynote-style" video of a product, or wants a site's "actual branding" or "actual colors/UI" captured into a video -- even if they don't name this skill directly. Also trigger on "make a product launch video from <url>", "turn this website into a video", or "capture this site's design and make a trailer for it".
---

# website-to-video

Turns a real website into a finished product-launch video: capture the site's
actual design, write and voice a script, storyboard an Apple-keynote-style
reveal, build it in HyperFrames, score it, render it, and QC it. This is a
**pipeline skill** — it chains other capabilities already in this repo
(`hyperframes capture`, `hyperframes tts`, deterministic GSAP compositions,
the `watchutube` skill) rather than reinventing any of them.

The single hardest-won lesson behind this skill: **never invent the brand**.
A generic dark-gradient SaaS look is not what was asked for, even if it looks
premium. Every color, every headline, every benefit claim in the output must
trace back to something actually captured from the site (or explicitly
supplied by the user) — see step 1.

## Workflow

### 1. Capture the site's real design — and say plainly which method actually worked

Try, in this order, and **always tell the user which one you actually used**
(silently falling back is how you end up shipping invented branding):

1. **`hyperframes capture <url> -o capture --json`** — the primary method.
   Captures real screenshots, computed colors, fonts, and page structure as
   editable components. Run it from inside the project directory (see step
   6 for the scaffold). This needs outbound network access to the target
   domain, which is blocked by policy on some sandboxed sessions for
   arbitrary third-party domains — if it fails, don't retry blindly; check
   the actual error:
   - `net::ERR_TUNNEL_CONNECTION_FAILED` / an `EGRESS_BLOCKED` style error →
     this is a network policy block, not a flaky failure. Retrying won't
     help. Move to method 2, and say plainly to the user that live capture
     was blocked and why — see `references/capture-fallback.md`.
   - Any other failure (timeout, bad selector, etc.) → read the error, it's
     usually fixable (raise `--timeout`, add `--skip-vision` to skip the
     slower AI captioning pass, etc).
2. **`WebFetch`** on the URL — a separate fetch path from `hyperframes
   capture`'s browser, so it can succeed even when method 1 is blocked (or
   vice versa). Good for extracting real headline/subheadline copy, benefit
   descriptions, and CTA text even without visual capture. It won't give
   you exact colors or a screenshot to work from, though.
3. **User-supplied screenshots or a pasted brand description.** If both
   automated methods are blocked or the user already has assets, ask for
   screenshots of the hero section, a feature/benefit section, and the
   pricing/CTA area — enough to *see* the actual palette, type, and UI
   density. Read the images directly and extract hex-ish colors and the
   typographic feel from what you see, same as you would from a capture.

Whichever method works, read `references/capture-fallback.md` for exactly
what to extract and how to turn a screenshot into a usable palette/type
read when `hyperframes capture` isn't available.

**If every method fails and the user doesn't have assets to hand**, stop and
ask them directly (screenshots, a description, or explicit permission to use
placeholder branding) rather than guessing — see the "Never invent the
brand" note above.

### 2. Extract the real design system

From whatever step 1 produced, write down (literally, before touching code):

- **Colors**: primary/background, 1-2 accent colors, text colors, in real
  hex. Pull these from the capture's computed styles when available; from a
  screenshot, sample the dominant hues you can actually see (background,
  button/accent, heading text) rather than guessing a plausible palette.
- **Typography**: the actual font family if identifiable (check the
  capture's font list, or a screenshot's letterforms against known
  typefaces), the weight the brand leans on (thin/regular/bold/black), and
  the letter-spacing feel (tight and modern vs. wide and airy).
- **UI style**: corner radius (sharp/soft/pill), shadow depth (flat/subtle/
  dramatic), gradient usage, spacing density (tight dashboard vs. airy
  marketing page). This is what makes the animated UI mockups in step 4 read
  as *this* product's UI, not a generic one.
- **Brand tone**: playful, serious, technical, luxury, minimal, maximalist —
  read from the copy's voice and the UI's polish level, not assumed.
- **2-4 strongest benefits**, in the site's own words where possible (don't
  paraphrase into blander marketing-speak — the site's actual phrasing is
  part of its brand voice).

### 3. Write and voice the script

Budget the runtime like this (adjust proportionally for a different total
duration, but keep the shape): cold open hook (~10-15%) → product reveal
(~15-20%) → one beat per benefit card (~15-20% each) → CTA (~10-15%). Leave
real room for silent visual beats (a UI zoom landing, a card settling) —
constant narration under every frame reads as rushed, not premium; the empire
title and hero-stat-card projects in this repo (`videos/empire-title`,
`videos/hero-209-billion`) both lean on silence and motion doing work the VO
doesn't need to.

Write VO at roughly 2.2-2.6 words/sec for a confident, unhurried keynote
delivery (slower than a hype-reel VO) minus whatever time you budgeted for
silent beats. Short, declarative lines — this is Jony-Ive-keynote register,
not ad-copy register: "This changes everything," not "Introducing the
revolutionary new way to totally transform how you work!"

Synthesize it for real rather than guessing at timing:

```bash
hyperframes tts "Your script line." -o audio/vo_01.wav --voice af_heart --json
```

The JSON result's `durationSeconds` is the *actual* spoken length — use it to
size each VO-carrying scene/segment, don't estimate. Generate one file per
beat (hook / reveal / each benefit / CTA) so each maps cleanly to its own
timeline segment; `--voice` options are listed by `hyperframes tts --list`
(defaults to `af_heart`, a warm, clear American voice — good default for
this register, but pick to match brand tone: `am_michael`/`bm_george` read
more corporate/authoritative, `bf_emma`/`bf_isabella` more editorial).

### 4. Storyboard the Apple-keynote beats

The reveal has a recognizable shape — reuse it rather than reinventing the
genre:

1. **Cold open**: near-black or brand-dark background, product wordmark
   assembles/reveals dramatically (see `videos/empire-title` for a real,
   working reference: gold letter-groups sliding together with an impact
   flash+sound, then a fast zoom-out exit — the same *technique* applies
   here with the captured brand's own colors/type instead of gold Cinzel).
2. **Product reveal**: the wordmark settles, a tagline lands, first real UI
   glimpse.
3. **UI zooms**: animated pans/zooms across a **real DOM/CSS recreation** of
   the captured UI — recreate the actual layout, colors, and copy as HTML/
   CSS elements, not a screenshot blown up. A raster screenshot as the hero
   visual reads as a video *about* a screenshot, not a video *of* the
   product; a live recreation can be camera-pushed, lit, and animated the
   way the rest of the piece is. Keep the captured screenshots as visual
   *reference* for what to build, not as the asset itself.
4. **Benefit cards** (2-4): one per card — icon or small UI glyph, a short
   headline (the site's own phrasing), a one-line sub. Stagger their entrance
   (each card's motion offset from the last, not simultaneous) for a
   confident, deliberate cadence rather than a pile-on.
5. **CTA**: the site's actual CTA copy ("Get Started", "Start Free Trial",
   whatever it actually says) on a clean closing card, brand wordmark small
   beneath it.

### 5. Build it in HyperFrames

Read `references/conventions.md` before writing any composition code — it
distills the patterns already proven working in this repo's
`videos/empire-title`, `videos/oxblood-countdown`, and
`videos/hero-209-billion` projects (real DOM text never rasterized,
deterministic GSAP with no `Math.random`/`Date.now`, layered-blur glow
technique, the `data-composition-id`/`data-duration`/`data-fps` structure,
and — critically — verifying with `hyperframes check` and `hyperframes
snapshot` across the *whole* timeline before ever spending a render). Don't
re-derive these from scratch; they're already worked out and tested.

Scaffold the project the same way those do (see `videos/oxblood-countdown/`
for the exact shape): `package.json` with `hyperframes` pinned as a local
devDependency plus `render`/`cloud`/`cloud:wait` scripts, `vendor/gsap.min.js`
vendored locally, fonts vendored under `assets/fonts/`, VO/SFX under
`assets/`.

### 6. Score it

Generate deterministic SFX the same way `videos/empire-title/
generate-audio.mjs` and `videos/oxblood-countdown/generate-audio.mjs` do —
see `references/sfx-synthesis.md` for the actual synthesis techniques (soft
whoosh on a UI zoom, a light tick on each card's entrance, a subtle
chime/impact on the CTA landing). No external audio libraries; this is a
plain Node script writing PCM samples directly, matching the exact duration
of the composition and mixed against the VO clips from step 3.

### 7. Verify, then render

**Before any render**, run `hyperframes check` (fix every error; treat
warnings as real unless you have a specific reason not to) and
`hyperframes snapshot --at <comma-separated timestamps covering the whole
timeline>` — actually look at the resulting frames. This catches layout
bugs, timing mismatches, and readability problems for free; every render
costs real time (and, for cloud, real money).

Then render. **This repo's root `CLAUDE.md` governs the render path** — read
it if you haven't already this session. In short: cloud
(`npm run cloud:wait`) is the default, but confirm with the user immediately
before every single cloud render (never batch-approve); on decline, or if
`HEYGEN_API_KEY`/wallet isn't available, fall back to a local render
(`npm run render`) instead of failing.

### 8. QC with `watchutube`

Run the finished render through the `watchutube` skill and check: pacing
(cuts/zooms landing with intent, not randomly), color consistency across the
piece (the captured brand palette holding steady scene to scene),
`loudness_lufs` (mix/delivery sanity), and that on-screen text stays legible
(`on_screen_text`'s readability read). Report what passed and what to fix,
then iterate on the composition and re-render rather than shipping a render
you haven't actually looked at.

## Reference files

- `references/conventions.md` — the deterministic-GSAP/real-DOM-text/
  layered-glow/verify-before-render conventions this skill's compositions
  should follow, with concrete examples from this repo's existing projects.
- `references/capture-fallback.md` — what to do when `hyperframes capture`
  is blocked or unavailable, and how to extract a usable palette/type/tone
  read from a screenshot or from `WebFetch`-only copy.
- `references/sfx-synthesis.md` — the deterministic WAV-synthesis technique
  (envelopes, filtered noise, pitch-drop sines) for whoosh/tick/chime SFX,
  with working code patterns drawn from this repo's `generate-audio.mjs`
  files.
