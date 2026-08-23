// Deterministic WAV synth for the neon logo reveal.
// 8.5s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design (synced to the GSAP timeline in index.html):
//   0.00-8.50s  low electrical neon hum bed (breathes with the sign)
//   0.35-1.35s  six ignition "zaps" as each letter's tube catches
//   1.70s       sub-bass power-on boom when the full sign lights
//   2.05s       WHOOSH — whip-pan transition (logo -> kinetic words)
//   2.55-3.07s  three punch impacts as DESIGN / MOTION / LIGHT hit
//   3.95s       WHOOSH — brighter edge-wipe transition (-> framed statement)
//   5.85s       riser + bright SHIMMER bloom — dip-to-glow (-> end lockup)
//   6.75s       rising zip as the underline rule draws
//   7.20-8.50s  hum settles, gentle shimmer tail, fade to silence
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 8.5;
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
const add = (i, v) => {
  if (i >= 0 && i < N) buf[i] += v;
};

/* ---- neon hum bed: 60Hz mains buzz + harmonics, faint & always there ---- */
for (let i = 0; i < N; i++) {
  const t = i / SR;
  // swells in as the sign lights, breathes gently through the hold
  const env =
    0.05 *
    smooth(0.2, 1.7, t) *
    (0.85 + 0.15 * Math.sin(2 * Math.PI * 0.5 * t)) *
    (1 - smooth(DUR - 0.25, DUR, t));
  let s = 0;
  s += Math.sin(2 * Math.PI * 60 * t) * 1.0;
  s += Math.sin(2 * Math.PI * 120 * t) * 0.5;
  s += Math.sin(2 * Math.PI * 180 * t) * 0.22;
  s += rnd() * 0.06; // faint electrical hiss
  buf[i] += s * env;
}

/* ---- ignition zaps: short bright electric ticks as each tube catches ---- */
const zapTimes = [0.35, 0.55, 0.75, 0.95, 1.15, 1.35];
zapTimes.forEach((zt, idx) => {
  const start = Math.floor(zt * SR);
  const len = Math.floor(0.08 * SR);
  const base = 900 + idx * 120; // each letter a touch higher — rising sparkle
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.018);
    // buzzy tone + noise crackle
    const tone =
      Math.sin(2 * Math.PI * base * tk) * 0.5 +
      Math.sin(2 * Math.PI * base * 2.5 * tk) * 0.25 +
      rnd() * 0.9;
    add(start + k, tone * env * 0.11);
  }
});

/* ---- power-on boom: sub-bass thump as the full sign lights (1.70s) ---- */
{
  const start = Math.floor(1.7 * SR);
  const len = Math.floor(1.0 * SR);
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.34) * (1 - Math.exp(-tk / 0.004));
    const pf = 48 + 34 * Math.exp(-tk / 0.05); // pitch drop 82 -> 48 Hz
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.4 * Math.sin(2 * Math.PI * pf * 2 * tk);
    add(start + k, body * env * 0.6);
  }
}

/* ---- whoosh: filtered-noise sweep for a transition ---- */
function whoosh(centerT, dur, gain, bright) {
  const start = Math.floor((centerT - dur * 0.5) * SR);
  const len = Math.floor(dur * SR);
  let lp = 0;
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const p = k / len; // 0..1
    // amplitude swells then falls (bell-ish)
    const amp = Math.sin(Math.PI * p);
    // low-pass cutoff rises through the sweep => brightening whoosh
    const cutoff = 0.02 + bright * smooth(0, 0.7, p);
    lp += cutoff * (rnd() * 2 - lp);
    // a resonant tone riding the sweep adds "pitch" to the wind
    const tone = Math.sin(2 * Math.PI * (220 + 900 * p) * tk) * 0.15;
    add(start + k, (lp * 0.85 + tone) * amp * gain);
  }
}

/* ---- impact: tight punch for a word landing ---- */
function impact(atT, gain, pitch) {
  const start = Math.floor(atT * SR);
  const len = Math.floor(0.22 * SR);
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.06) * (1 - Math.exp(-tk / 0.002));
    const pf = pitch * (0.6 + 0.4 * Math.exp(-tk / 0.03));
    const body = Math.sin(2 * Math.PI * pf * tk) + rnd() * 0.5 * Math.exp(-tk / 0.01);
    add(start + k, body * env * gain);
  }
}

/* ---- shimmer: bright airy bell cluster for the glow bloom ---- */
function shimmer(atT, dur, gain) {
  const start = Math.floor(atT * SR);
  const len = Math.floor(dur * SR);
  const partials = [1568, 2093, 2637, 3136, 4186]; // stacked high bells
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / (dur * 0.4)) * (1 - Math.exp(-tk / 0.006));
    let s = 0;
    for (let pi = 0; pi < partials.length; pi++) {
      s += Math.sin(2 * Math.PI * partials[pi] * tk) * (1 - pi * 0.16);
    }
    add(start + k, (s / partials.length) * env * gain);
  }
}

// Transition 1 — whip pan (2.05s): fast, mid-bright whoosh
whoosh(2.2, 0.5, 0.22, 0.22);
// word punches
impact(2.55, 0.34, 150);
impact(2.81, 0.32, 170);
impact(3.07, 0.34, 190);

// Transition 2 — edge wipe (3.95s): brighter, longer sweep + a "zip" at the edge
whoosh(4.15, 0.6, 0.2, 0.34);
{
  // metallic zip as the neon edge passes center (~4.2s)
  const start = Math.floor(4.12 * SR);
  const len = Math.floor(0.16 * SR);
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.03);
    add(start + k, Math.sin(2 * Math.PI * (2600 - 4000 * tk) * tk) * env * 0.14);
  }
}

// Transition 3 — dip to glow (5.85s): riser -> bright shimmer bloom + soft boom
whoosh(6.05, 0.7, 0.22, 0.45);
shimmer(6.12, 1.4, 0.16);
{
  const start = Math.floor(6.12 * SR);
  const len = Math.floor(0.8 * SR);
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.3) * (1 - Math.exp(-tk / 0.004));
    const pf = 55 + 30 * Math.exp(-tk / 0.05);
    add(start + k, Math.sin(2 * Math.PI * pf * tk) * env * 0.42);
  }
}

// underline rule draw (6.75s): quick rising zip
{
  const start = Math.floor(6.75 * SR);
  const len = Math.floor(0.5 * SR);
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const p = k / len;
    const env = Math.sin(Math.PI * p) * Math.exp(-tk / 0.35);
    add(start + k, Math.sin(2 * Math.PI * (400 + 1400 * p) * tk) * env * 0.07);
  }
}

// final gentle shimmer tail on the end lockup
shimmer(7.15, 1.2, 0.06);

/* ---- normalize + soft-clip + end fade to true silence ---- */
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
const fadeStart = Math.floor((DUR - 0.18) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.05);
  if (i >= fadeStart) v *= 1 - (i - fadeStart) / (N - fadeStart);
  buf[i] = clamp(v);
}

/* ---- write 16-bit PCM WAV ---- */
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
writeFileSync(new URL("./assets/neon.wav", import.meta.url), out);
console.log(`wrote assets/neon.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
