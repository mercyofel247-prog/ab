// Deterministic WAV synth for "SEIZED — In 48 Hours" (Shot 2).
// 4.5s, 48kHz, 16-bit mono. No dependencies, no Math.random/Date.now.
//
// Authored to the same frames as the picture (24fps):
//   0.00-1.50s (f0-36)   crash-zoom air/whoosh riser + low pressure
//   1.50s      (f36)     BIG sub-boom + short metallic STAMP clunk (slam/stamp)
//   1.50-4.30s (f36-103) low bed at rising peak through the hold
//   4.30-4.50s (f103-108) settle into the exit
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 4.5;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const BOOM_T = 1.5; // frame 36 — the slam/stamp lands here

// --- deterministic RNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5e12ed00);

const clamp = (x) => Math.max(-1, Math.min(1, x));
const smooth = (a, b, t) => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
};

// one-pole low-pass states
let lp = 0;
let lp2 = 0;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;

  // --- low pressure drone building into the slam ---
  if (t < BOOM_T + 0.05) {
    const droneEnv = 0.12 * smooth(0.1, 1.4, t);
    const freq = 42 + 12 * smooth(0.1, BOOM_T, t); // 42 -> 54 Hz
    s += Math.sin(2 * Math.PI * freq * t) * droneEnv;
    s += Math.sin(2 * Math.PI * freq * 1.5 * t) * droneEnv * 0.2;
  }

  // --- crash-zoom air/whoosh: band-passed noise sweeping up into the slam ---
  const whooshEnv = smooth(0.15, BOOM_T, t) * (1 - smooth(BOOM_T - 0.03, BOOM_T + 0.06, t));
  if (whooshEnv > 0) {
    const white = rnd() * 2 - 1;
    // rising cutoff => brighter/closer as the word rushes in
    const cutoff = 0.015 + 0.24 * smooth(0.15, BOOM_T, t);
    lp += cutoff * (white - lp);
    lp2 += cutoff * (lp - lp2);
    s += (lp - lp2 * 0.6) * whooshEnv * 0.2; // band-pass-ish "air"
  }

  // --- sustained bed after the slam: rising peak through the hold, settle at exit ---
  if (t >= BOOM_T) {
    const bedEnv =
      0.10 * smooth(BOOM_T, BOOM_T + 0.5, t) *
      (0.7 + 0.3 * smooth(BOOM_T, 4.3, t)) *
      (1 - smooth(4.3, 4.5, t) * 0.85);
    const bf = 48 + 6 * smooth(BOOM_T, 4.3, t);
    s += Math.sin(2 * Math.PI * bf * t) * bedEnv;
    s += Math.sin(2 * Math.PI * bf * 2.0 * t) * bedEnv * 0.16;
  }

  buf[i] = s;
}

// --- BIG sub-boom at frame 36 ---
const boomStart = Math.floor(BOOM_T * SR);

// (a) attack transient
{
  let click = 0;
  const len = Math.floor(0.03 * SR);
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const env = Math.exp(-k / (0.006 * SR));
    click += 0.4 * (rnd() * 2 - 1 - click);
    buf[boomStart + k] += click * env * 0.9;
  }
}

// (b) boom body: detuned low sines with a pitch drop for weight
{
  const len = Math.floor(1.3 * SR);
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.32);
    const pf = 55 + 30 * Math.exp(-tk / 0.07); // ~85Hz -> ~55Hz
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.5 * Math.sin(2 * Math.PI * (pf * 0.75) * tk);
    buf[boomStart + k] += body * env * 0.9;
  }
}

// (c) metallic STAMP clunk: short bright inharmonic transient (the seal striking)
{
  const len = Math.floor(0.14 * SR);
  const partials = [1, 2.76, 5.4, 8.93]; // inharmonic => metallic
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.035) * (1 - Math.exp(-tk / 0.0008));
    let ring = 0;
    for (const p of partials) ring += Math.sin(2 * Math.PI * 430 * p * tk);
    buf[boomStart + k] += (ring / partials.length) * env * 0.28;
  }
}

// (d) short impact resonance
{
  const len = Math.floor(0.6 * SR);
  const ringF = 160;
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.26) * (1 - Math.exp(-tk / 0.006));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.4 * Math.sin(2 * Math.PI * ringF * 2.01 * tk);
    buf[boomStart + k] += ring * env * 0.1;
  }
}

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.92 / peak : 1;
const fadeStart = Math.floor((DUR - 0.1) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.1);
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
out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22);
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * bytesPerSample, 28);
out.writeUInt16LE(bytesPerSample, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(dataSize, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(buf[i] * 32767), 44 + i * bytesPerSample);
}
writeFileSync(new URL("./assets/boom.wav", import.meta.url), out);
console.log(`wrote assets/boom.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
