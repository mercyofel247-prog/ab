# Deterministic SFX synthesis

Same technique as `videos/empire-title/generate-audio.mjs` and
`videos/oxblood-countdown/generate-audio.mjs`: a plain Node script (no
dependencies — `node generate-audio.mjs`) that writes raw PCM samples into a
`Float64Array` buffer, then encodes a 16-bit WAV by hand. No audio library,
nothing to install, and every run produces byte-identical output because
the "noise" is a seeded deterministic PRNG, never `Math.random()`.

Read one of the two files above in full before writing a new synth script —
they're short, working, and cover most of what's below already. This doc is
the pattern reference, not a replacement for reading real code.

## The shared skeleton

```js
import { writeFileSync } from "node:fs";
const SR = 48000;
const DUR = <total composition duration, seconds — matches index.html exactly>;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

// deterministic pseudo-noise (mulberry32) -- NEVER Math.random()
let seed = 0x9e3779b9 >>> 0;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; // -0.5..0.5
}
const clamp = (x) => Math.max(-1, Math.min(1, x));

// ... add each SFX event into `buf` at its sample offset (see below) ...

// normalize + soft-clip + fade the tail to true silence, then write WAV
// (copy this block verbatim from either reference file -- it's boilerplate)
```

Every SFX event is just: pick a sample offset (`Math.floor(eventTimeSec *
SR)`), then add a short enveloped waveform into `buf` starting there. Events
at different timestamps just don't overlap; events that do overlap (rare —
keep SFX sparse) simply sum, which is usually fine since everything is kept
quiet relative to the VO.

## UI zoom whoosh

A rising-then-falling filtered noise swell, timed to lead into (not exactly
on) the zoom's arrival — same shape as the "rising whoosh" in
`empire-title/generate-audio.mjs`, just shorter and quieter (a UI zoom is a
much smaller event than a title-card impact):

```js
const zoomStart = 1.2, zoomLand = 1.5; // match the GSAP zoom tween's own timing
let lp = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  if (t < zoomStart || t > zoomLand) continue;
  const env = Math.sin(Math.PI * (t - zoomStart) / (zoomLand - zoomStart)); // smooth rise+fall
  const white = rnd() * 2;
  lp += 0.15 * (white - lp); // one-pole low-pass, keeps it a "whoosh" not white noise
  buf[i] += lp * env * 0.10; // keep SFX well under VO/music level
}
```

## Card-entrance tick

A very short, high-passed click — same "attack transient" building block
used for the impact sound's leading edge, just smaller and without the deep
boom body that follows it in that file:

```js
function tick(atSec, gain = 0.12) {
  const start = Math.floor(atSec * SR);
  let hp = 0, prev = 0;
  const len = Math.floor(0.02 * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.004 * SR));
    const white = rnd() * 2;
    hp = white - prev; prev = white; // crude high-pass -> reads as a "tick" not a "thud"
    buf[start + k] += hp * env * gain;
  }
}
// call once per benefit card's entrance timestamp
tick(2.10); tick(2.35); tick(2.60);
```

## CTA chime / soft impact

For a confident-but-gentle landing on the final CTA card (not a huge boom —
this is a product reveal ending on an invitation, not a title-card slam):
combine a short attack click with a couple of consonant sine partials
(a musical interval reads as a "chime", not a "hit"):

```js
function chime(atSec, gain = 0.5) {
  const start = Math.floor(atSec * SR);
  const len = Math.floor(0.5 * SR);
  const partials = [660, 990, 1320]; // root + fifth + octave-ish -- consonant, not metallic-harsh
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.22) * (1 - Math.exp(-tk / 0.003));
    let s = 0;
    for (const [i, f] of partials.entries()) s += Math.sin(2 * Math.PI * f * tk) / (i + 1);
    buf[start + k] += s * env * gain;
  }
}
```

## Mixing against VO

If you're compositing SFX and VO into the *same* WAV file (rather than
separate `<audio>` elements on separate tracks — either approach works, but
a single mixed file is simpler for keeping levels sane): decode each VO
WAV's samples, add them into `buf` at the right offset, keep SFX gains low
(0.05-0.15 range as in the examples above) relative to VO peak so nothing
steps on the narration. If you'd rather keep them separate, just place each
VO clip and SFX file as its own `<audio>` element with its own `data-start`/
`data-track-index` in the composition — HyperFrames mixes tracks at render
time, so either approach is legitimate; separate files are easier to re-time
independently while iterating, a single mixed file is simpler to reason
about final levels for.

## Sanity-check timing, not just by ear

You can't literally listen to the output. Verify a specific event actually
lands where intended by checking the RMS loudness curve around that
timestamp:

```bash
ffmpeg -i out.wav -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - 2>/dev/null \
  | python3 -c "
import sys, re
lines = sys.stdin.read().splitlines()
t = None
for line in lines:
    if line.startswith('frame:'):
        m = re.search(r'pts_time:([\d.]+)', line)
        if m: t = float(m.group(1))
    elif 'RMS_level=' in line and t is not None:
        val = line.split('RMS_level=')[1].strip()
        if 1.0 <= t <= 2.0:  # window around the event you're checking
            print(f'{t:.3f}s  {val} dB')
        t = None
"
```

A real event should show as silence/near-silence before it, a sharp jump at
the intended timestamp, then a decay — exactly the shape used to verify
`empire-title`'s impact sound was correctly timed and survived the render
pipeline unchanged.
