# HyperFrames composition conventions

Patterns already proven working in this repo's `videos/empire-title`,
`videos/oxblood-countdown`, and `videos/hero-209-billion` projects. Read this
before writing composition HTML/CSS/JS for a website-to-video build — these
aren't stylistic preferences, each one was arrived at after hitting the
failure mode it prevents.

## Project scaffold

Mirror `videos/oxblood-countdown/`'s shape exactly:

```
<project>/
  index.html          the composition (see structure below)
  package.json         hyperframes pinned as a local devDependency + scripts
  .gitignore            node_modules/, snapshots/, .debug/
  .hyperframesignore    package-lock.json, generate-audio.mjs, .gitignore
  generate-audio.mjs     deterministic SFX synth (see sfx-synthesis.md)
  vendor/gsap.min.js     vendored, not fetched from a CDN at render time
  assets/
    fonts/                vendored webfont files (see Typography below)
    vo_*.wav                per-beat voiceover clips from `hyperframes tts`
    sfx.wav                  or per-effect files, from generate-audio.mjs
  renders/                render output lands here
```

`package.json` scripts, verbatim pattern:

```json
{
  "scripts": {
    "dev": "hyperframes preview",
    "check": "hyperframes check",
    "render": "hyperframes render",
    "cloud": "hyperframes cloud render --fps=24 --resolution=1080p --aspect-ratio=16:9 --quality=high --no-wait",
    "cloud:wait": "hyperframes cloud render --fps=24 --resolution=1080p --aspect-ratio=16:9 --quality=high -o renders/<name>.mp4",
    "cloud:list": "hyperframes cloud list",
    "cloud:get": "hyperframes cloud get",
    "audio": "node generate-audio.mjs",
    "publish": "hyperframes publish"
  },
  "devDependencies": { "hyperframes": "0.7.107" }
}
```

## Composition structure

```html
<div id="root" data-composition-id="main" data-start="0" data-duration="<N>"
     data-fps="24" data-width="1920" data-height="1080">
  <section id="stage" class="clip" data-start="0" data-duration="<N>" data-track-index="1">
    <!-- visual layers -->
  </section>
  <audio id="vo1" data-start="0" data-duration="<N>" data-track-index="2"
         src="assets/vo_01.wav" data-volume="1"></audio>
  <!-- one <audio> per VO clip / SFX, each on its own track-index -->
</div>
```

GSAP timeline, always paused and driven by `window.__timelines`:

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
// gsap.set(...) for every element's initial state, then tl.to(...) calls
window.__timelines["main"] = tl;
```

## Real DOM text, never rasterized

Every headline, benefit label, and CTA is a literal text node styled with
CSS — never a rendered/screenshotted image of text. This is why: real text
can't misspell or warp under scale, stays crisp at any zoom level HyperFrames
applies, and is what makes a "recreate the UI" scene actually feel like the
product's live UI instead of a photo of it.

The gradient/glow "hero text" look (used for wordmarks, big stat numbers,
benefit headlines) is `background-clip: text`:

```css
.hero-text {
  background: linear-gradient(180deg, <bone-color> 0%, <accent> 45%, <deep> 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(1px 1px 0 <deep>) drop-shadow(0 0 24px <accent-glow>);
}
```

When you need a glow/rim/shine layer *behind or over* that same text (a
colored rim light, a light-sweep shine), duplicate the text into a sibling
element with `grid-area: 1 / 1` inside a `display: grid; place-items: center`
parent — this is what makes the layers actually overlap instead of stacking
vertically. **This is the single most common bug when building these
scenes**: forgetting that a child needs `grid-area: 1/1` on a
`display:grid` *parent specifically* — if the glow layer's own children
(e.g. three stacked blur clones for a dimensional glow) need to overlap
*each other* too, that inner wrapper also needs `display: grid` itself, not
just the outermost one. Verify with `hyperframes snapshot` early — a glow
that renders as a separate line above the text instead of hugging it is
this bug.

## Deterministic, always

No `Math.random()`, no `Date.now()`, anywhere in composition JS. Every
animated value — including "randomized" things like particle placement or
staggered entrance timing — is a fixed formula keyed off an index, so the
render is bit-identical every run. The golden-ratio-conjugate trick gives
even, non-repeating-looking spread without real randomness:

```js
const GOLDEN_PCT = 61.803398875;
const xPct = (i * GOLDEN_PCT) % 100; // deterministic, well-distributed
```

## Dimensional glow (rim light / bloom)

Three stacked clones of the same element at increasing blur radius and
decreasing opacity reads as a real layered bloom, not a flat glow:

```css
.glow-tight { filter: blur(2px); opacity: 0.9; }
.glow-mid   { filter: blur(15px); opacity: 0.55; }
.glow-wide  { filter: blur(36px); opacity: 0.32; }
```

Animate the whole glow group's opacity (not each clone separately) if you
want it to "breathe" — one tween on the wrapper, all three clones ride it.

## Letter-spacing centering compensation

`letter-spacing` adds trailing space after the *last* character too, which
visibly throws off `text-align: center` in a fixed-width container. Fix:
`padding-right: <same value as letter-spacing>` on the text element. If the
word is split into multiple entrance groups (see below), this padding goes
on the *last* group only, not every group — a middle group's own trailing
letter-spacing is a legitimate inter-letter gap, not a centering artifact.

## Split-word entrance choreography

For a wordmark/headline that arrives as multiple pieces converging (e.g.
letters sliding in from different directions and meeting at center), split
into `<span>` groups with **zero whitespace between the tags** in the HTML
source (`<span>ABC</span><span>DEF</span>`, not with a newline/space between
them — that whitespace becomes a visible gap once they're `inline-block`).
Give each group its own gradient/fill styling (identical gradient value
across groups reads as one seamless word once they meet, since a vertical
gradient's color only depends on Y position, not which group is which).

## Verify before every render

`hyperframes check` first — 0 errors is the bar; read every warning (a
`gsap_css_transform_conflict` or `overlapping_gsap_tweens` warning is a real
bug, not noise — e.g. setting `transform: scale(1)` in CSS on an element
GSAP also tweens `scale` on will silently break the CSS value). Then
`hyperframes snapshot --at <timestamps across the whole timeline> -o
<scratch-dir>` and actually look at the PNGs (or the auto-generated
contact sheet) before rendering — this catches layout/timing bugs for the
cost of a few seconds instead of a full render. For gaps/pacing specifically,
`hyperframes keyframes --json` lists every tween's start/end, so you can
programmatically check for dead time (nothing animating) across the runtime
if "no delay anywhere" is a requirement.

## Fonts

Vendor the actual webfont file under `assets/fonts/` and `@font-face` it —
don't rely on a CDN fetch at render time (unreliable in a sandboxed render
environment, and breaks the "identical every run" determinism goal). Public
OFL-licensed fonts are fetchable from `https://raw.githubusercontent.com/
google/fonts/main/ofl/<family>/<File>.ttf` when you need a specific
typeface (e.g. a heavy condensed display face, or a cinematic serif) and it
isn't already vendored somewhere in this repo's other video projects.

## Audio wiring

Each `<audio>` element's `data-start` is where it begins *in the
composition timeline* — the sound content should begin immediately in the
file itself (pad the WAV with leading silence if you need the actual audible
event to land at a specific composition timestamp later than `data-start`,
same as `videos/empire-title/generate-audio.mjs` does with `IMPACT_T`).
`data-track-index` must be unique per audio/video element sharing the
timeline (video content itself typically claims track-index 1).
