// Deterministic WAV score for "Oxblood Collapse".
// 4.0s, 48kHz, 16-bit mono. No dependencies. Authored to the same frames
// as the visual timeline (24fps):
//   0.00-1.40s  (f0-34)   rising unease under the fall
//   1.40s       (f34)     LOW sub-boom lands on the line's landing / the cut
//   1.40-1.65s  (f34-40)  impact body + hollow bloom
//   1.65-3.80s  (f40-91)  tick pulse tightens; heavy bed sustains
//   3.80-4.00s  (f91-96)  settle into the exit
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 4.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const BOOM_T = 1.4; // frame 34 — the landing

// deterministic pseudo-noise (mulberry32)
let seed = 0x0b100d >>> 0;
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

let lp = 0; // one-pole LP state for the riser

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;

  // --- rising unease: low drone that tightens toward the fall ---
  if (t < BOOM_T + 0.05) {
    const env = 0.13 * smooth(0.0, 1.2, t) * (1 - smooth(BOOM_T - 0.1, BOOM_T + 0.05, t) * 0.3);
    const freq = 44 + 12 * smooth(0.2, BOOM_T, t); // 44 -> 56 Hz, climbing
    s += Math.sin(2 * Math.PI * freq * t) * env;
    s += Math.sin(2 * Math.PI * freq * 1.5 * t) * env * 0.22; // 5th for body
  }

  // --- accelerating noise swell (the plunge), peaks at the landing ---
  const swellEnv = smooth(0.3, BOOM_T, t) * (1 - smooth(BOOM_T - 0.03, BOOM_T + 0.08, t));
  if (swellEnv > 0) {
    const white = rnd() * 2;
    const cutoff = 0.015 + 0.22 * smooth(0.3, BOOM_T, t);
    lp += cutoff * (white - lp);
    s += lp * swellEnv * 0.15;
  }

  // --- heavy sustained bed after the boom (keeps the frame heavy) ---
  if (t >= BOOM_T) {
    const bed = 0.075 * smooth(BOOM_T, BOOM_T + 0.25, t) * (1 - smooth(3.8, 4.0, t) * 0.85);
    s += Math.sin(2 * Math.PI * 47 * t) * bed;
    s += Math.sin(2 * Math.PI * 47 * 2.0 * t) * bed * 0.18;
  }

  buf[i] = s;
}

// --- LOW SUB-BOOM at frame 34 ---
const boomStart = Math.floor(BOOM_T * SR);
// (a) attack transient
{
  let click = 0;
  const len = Math.floor(0.028 * SR);
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const env = Math.exp(-k / (0.006 * SR));
    click += 0.35 * (rnd() * 2 - click);
    buf[boomStart + k] += click * env * 0.75;
  }
}
// (b) sub body: low sine with a pitch drop — weighty "through the floor"
{
  const len = Math.floor(1.2 * SR);
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.34);
    const pf = 44 + 30 * Math.exp(-tk / 0.05); // 74 -> 44 Hz
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.45 * Math.sin(2 * Math.PI * pf * 0.75 * tk); // detuned sub → hollow
    buf[boomStart + k] += body * env * 0.9;
  }
}
// (c) hollow resonance bloom
{
  const len = Math.floor(0.8 * SR);
  const ringF = 120;
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.3) * (1 - Math.exp(-tk / 0.006));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.4 * Math.sin(2 * Math.PI * ringF * 2.01 * tk);
    buf[boomStart + k] += ring * env * 0.12;
  }
}

// --- tick pulse tightens from f40 (1.65s) onward, heavy through the hold ---
const tickTimes = [];
for (let tt = 1.65; tt < 3.75; ) {
  tickTimes.push(tt);
  // interval tightens over time (pulse "tightens")
  const prog = (tt - 1.65) / (3.75 - 1.65);
  tt += 0.34 - 0.14 * prog; // 0.34s → 0.20s
}
for (const tt of tickTimes) {
  const start = Math.floor(tt * SR);
  const len = Math.floor(0.045 * SR);
  const f = 200 + rnd() * 40;
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.009 * SR));
    const body = Math.sin(2 * Math.PI * f * (k / SR)) * 0.5 + rnd() * 0.5;
    buf[start + k] += body * env * 0.055;
  }
}

// --- normalize + soft-clip, fade the exit tail to a clean cut point ---
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
writeFileSync(new URL("./assets/collapse.wav", import.meta.url), out);
console.log(`wrote assets/collapse.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
