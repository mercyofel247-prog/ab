// Deterministic WAV synth for the Gyokuro investigation cold open.
// 30.0s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design beats (mirrors the visual timeline in index.html):
//   0.00-3.00   dark sub-drone tension riser under the two-beat hook, with a
//               stinger hit under each slam-in line
//   2.86-3.05   whoosh sweep into the evidence board
//   3.00-14.00  soft rhythmic tick bed + a paper-snap transient on every
//               card cut, small accents on the amino-burst and the
//               caffeine/theanine drift
//   14.00       glitch stab into the mechanism diagram
//   14.30-20.80 two converging motifs (amber "caffeine" blips, teal
//               "theanine" pad) resolving into a confirming bell
//   21.00       hard stab into the chaotic jitter beat
//   21.10-22.25 dissonant clicky bursts (the "jittery" brain)
//   22.60       whoosh/glitch into the still-water calm
//   23.30       a single bright droplet pluck
//   23.70-26.00 shimmering ripple resonance
//   25.60       resolving chime (the "aha" payoff)
//   27.50-30.00 warm pad tail, decaying to silence under the final fade
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 30.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

// --- deterministic pseudo-noise (mulberry32) ---
let seed = 0x9e3779b9 >>> 0;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; // -0.5..0.5
}

const clamp = (x) => Math.max(-1, Math.min(1, x));
const smooth = (a, b, t) => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
};
const idx = (t) => Math.floor(t * SR);

function addAt(t, v) {
  const i = idx(t);
  if (i >= 0 && i < N) buf[i] += v;
}

// short noise click with one-pole low-pass, e.g. paper snaps / stabs
function addClick(t0, dur, gain, cutoff = 0.5) {
  const start = idx(t0);
  const len = Math.floor(dur * SR);
  let lp = 0;
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (dur * 0.28 * SR));
    lp += cutoff * (rnd() * 2 - lp);
    addAt(t0 + k / SR, lp * env * gain);
  }
}

// sine tone with envelope + optional pitch glide (freqFn(t) in seconds-from-start)
function addTone(t0, dur, freqFn, gain, attack = 0.02, release = 0.3, shape = 1) {
  const start = idx(t0);
  const len = Math.floor(dur * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const a = smooth(0, attack, tk);
    const r = 1 - smooth(dur - release, dur, tk);
    const env = a * r;
    const f = freqFn(tk);
    let s = Math.sin(2 * Math.PI * f * tk);
    if (shape > 1) s += 0.35 * Math.sin(2 * Math.PI * f * 2 * tk); // add a little body
    addAt(t0 + tk, s * env * gain);
  }
}

// low sub hit: pitch-dropping sine + filtered noise transient ("stinger")
function addHit(t0, gain = 0.8, baseFreq = 60) {
  addClick(t0, 0.03, gain * 0.9, 0.4);
  const len = Math.floor(0.6 * SR);
  const start = idx(t0);
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.22);
    const pf = baseFreq + baseFreq * 0.6 * Math.exp(-tk / 0.05);
    addAt(t0 + tk, Math.sin(2 * Math.PI * pf * tk) * env * gain);
  }
}

// small bright pluck (water drop / bell accents)
function addPluck(t0, freq, dur, gain) {
  const start = idx(t0);
  const len = Math.floor(dur * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / (dur * 0.32));
    const pf = freq * (1 + 0.15 * Math.exp(-tk / 0.02));
    addAt(t0 + tk, Math.sin(2 * Math.PI * pf * tk) * env * gain);
  }
}

// bell cluster: a few detuned partials with slow decay
function addBell(t0, freqs, dur, gain) {
  freqs.forEach((f, i) => {
    const start = idx(t0);
    const len = Math.floor(dur * SR);
    const g = gain / (i + 1.3);
    for (let k = 0; k < len && start + k < N; k++) {
      const tk = k / SR;
      const env = Math.exp(-tk / (dur * 0.4)) * (1 - Math.exp(-tk / 0.006));
      addAt(t0 + tk, Math.sin(2 * Math.PI * f * tk) * env * g);
    }
  });
}

// rising/falling filtered-noise whoosh
function addWhoosh(t0, dur, gain, rising = true) {
  const start = idx(t0);
  const len = Math.floor(dur * SR);
  let lp = 0;
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const prog = tk / dur;
    const env = Math.sin(Math.PI * prog); // rise then fall in amplitude
    const cutoff = rising ? 0.02 + 0.35 * prog : 0.37 - 0.35 * prog;
    lp += cutoff * (rnd() * 2 - lp);
    addAt(t0 + tk, lp * env * gain);
  }
}

// ============================================================
// 0.00-3.00 — sub-drone tension riser + hook stingers
// ============================================================
{
  const len = Math.floor(3.0 * SR);
  let lp = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR;
    const env = 0.16 * smooth(0.0, 2.6, t);
    const freq = 34 + 6 * smooth(0, 3.0, t);
    let s = Math.sin(2 * Math.PI * freq * t) * env;
    const cutoff = 0.015 + 0.05 * smooth(0, 3.0, t);
    lp += cutoff * (rnd() * 2 - lp);
    s += lp * env * 0.35;
    addAt(t, s);
  }
}
addHit(0.12, 0.85, 52);
addHit(1.18, 0.55, 58);
addWhoosh(2.78, 0.3, 0.5, true);

// ============================================================
// 3.00-14.00 — evidence board: tick bed + card-cut snaps
// ============================================================
{
  const tickStart = 3.0;
  const tickEnd = 14.0;
  const tickInterval = 0.5;
  for (let t = tickStart; t < tickEnd; t += tickInterval) {
    addClick(t, 0.03, 0.05, 0.25);
  }
}
const cardCutTimes = [3.0, 5.0, 7.1, 9.2, 11.3];
cardCutTimes.forEach((t) => {
  addClick(t - 0.01, 0.08, 0.4, 0.55);
  addHit(t, 0.25, 90);
});
// card 1 — classified stamp thud
addClick(3.32, 0.06, 0.35, 0.6);
// card 3 — chemistry bars: three quick rising blips
[0, 0.08, 0.16].forEach((dt, i) => addPluck(7.55 + dt, 500 + i * 160, 0.18, 0.18));
// card 4 — amino burst accent
addBell(9.55, [900, 1350], 0.5, 0.22);
// card 5 — anticipation swell as the two dots drift together
addWhoosh(11.9, 1.9, 0.22, true);

// ============================================================
// 14.00 — glitch stab into the mechanism
// ============================================================
addClick(13.98, 0.05, 0.5, 0.7);
addHit(14.0, 0.6, 70);

// ============================================================
// 14.30-20.80 — mechanism: converging motifs + resolving bell
// ============================================================
// caffeine motif — quick ascending blips (amber, jittery)
[14.3, 14.55, 14.8].forEach((t, i) => addPluck(t, 660 + i * 160, 0.16, 0.16));
// theanine motif — a long smooth pad tone (teal, calm)
addTone(14.45, 3.0, () => 220, 0.14, 0.4, 1.2, 2);
addTone(14.45, 3.0, () => 220 * 1.5, 0.06, 0.4, 1.2, 1);
// confirming bell when the lines connect
addBell(17.3, [523.25, 659.25, 784.0], 2.6, 0.28);
// sustain pad under the caption, fading toward the hard cut
addTone(17.9, 2.8, () => 165, 0.09, 0.5, 1.0, 1);

// ============================================================
// 21.00 — hard stab into chaos
// ============================================================
addClick(20.98, 0.05, 0.55, 0.7);
addHit(21.0, 0.5, 64);

// ============================================================
// 21.10-22.25 — dissonant clicky bursts (the jittery brain)
// ============================================================
{
  const freqs = [740, 810, 690, 900, 770, 860, 700, 940, 780, 830];
  for (let i = 0; i < freqs.length; i++) {
    const t = 21.12 + i * 0.11;
    addPluck(t, freqs[i], 0.07, 0.12);
    addClick(t, 0.02, 0.08, 0.8);
  }
}

// ============================================================
// 22.60 — whoosh/glitch into the still water
// ============================================================
addWhoosh(22.55, 0.35, 0.45, false);
addClick(22.6, 0.04, 0.4, 0.7);

// ============================================================
// 22.70-27.20 — calm pad, droplet, ripple shimmer, resolve chime
// ============================================================
addTone(22.7, 4.5, () => 130, 0.1, 0.6, 1.5, 1);
addTone(22.7, 4.5, () => 130 * 1.5, 0.045, 0.6, 1.5, 1);
// the droplet — bright descending pluck
addPluck(23.3, 1200, 0.5, 0.28);
// ripple shimmer — three soft filtered-noise swells, widening and fading
[0, 0.16, 0.32].forEach((dt) => {
  const t0 = 23.72 + dt;
  const dur = 2.0;
  const start = idx(t0);
  const len = Math.floor(dur * SR);
  let lp = 0;
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = 0.05 * Math.exp(-tk / 0.9) * smooth(0, 0.1, tk);
    lp += 0.03 * (rnd() * 2 - lp);
    addAt(t0 + tk, lp * env);
  }
});
// resolving chime — the "aha" payoff, a warm major-ish cluster
addBell(25.6, [392.0, 493.88, 587.33, 784.0], 3.4, 0.24);

// ============================================================
// 27.50-30.00 — outro pad tail, decaying under the final fade
// ============================================================
addTone(27.5, 2.5, () => 98, 0.08, 0.3, 1.6, 1);

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.92 / peak : 1;
const fadeStart = Math.floor((DUR - 0.35) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.1); // soft-clip for warmth
  if (i >= fadeStart) v *= 1 - (i - fadeStart) / (N - fadeStart);
  buf[i] = clamp(v);
}

// --- write 16-bit PCM WAV ---
const bytesPerSample = 2;
const dataSize = N * bytesPerSample;
const out = Buffer.alloc(44 + dataSize);
out.write("RIFF", 0);
out.writeUInt32LE(36 + dataSize, 4);
out.write("WAVE", 8);
out.write("fmt ", 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); // PCM
out.writeUInt16LE(1, 22); // mono
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * bytesPerSample, 28);
out.writeUInt16LE(bytesPerSample, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(dataSize, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(buf[i] * 32767), 44 + i * bytesPerSample);
}
writeFileSync(new URL("./assets/score.wav", import.meta.url), out);
console.log(`wrote assets/score.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
