// Deterministic WAV synth for the empire-title impact hit.
// 8.0s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design:
//   0.00-1.55s  silence (the reveal is silent build-up until the hit)
//   1.55-1.75s  a brief rising whoosh as the letter groups close in
//   1.75s       IMPACT -- the two letter groups slam together
//   1.75-2.6s   deep boom body + bright metallic ring (gold-on-gold clang)
//               decaying into silence
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 8.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const IMPACT_T = 1.75; // the exact moment the letter groups converge (must match index.html)

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

// --- brief rising whoosh leading into the hit ---
let lp = 0;
const whooshStart = 1.55;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  if (t < whooshStart || t > IMPACT_T) continue;
  const env = smooth(whooshStart, IMPACT_T, t) * (1 - smooth(IMPACT_T - 0.03, IMPACT_T, t));
  const white = rnd() * 2;
  const cutoff = 0.05 + 0.25 * smooth(whooshStart, IMPACT_T, t);
  lp += cutoff * (white - lp);
  buf[i] += lp * env * 0.22;
}

const impactStart = Math.floor(IMPACT_T * SR);

// (a) attack transient: sharp filtered noise click
{
  let click = 0;
  const len = Math.floor(0.02 * SR);
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const env = Math.exp(-k / (0.004 * SR));
    click += 0.5 * (rnd() * 2 - click); // quick LP on noise
    buf[impactStart + k] += click * env * 1.0;
  }
}

// (b) deep boom body: detuned low sines with a fast pitch drop -- the weight
// of the impact
{
  const len = Math.floor(0.7 * SR);
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.16);
    const pf = 65 + 30 * Math.exp(-tk / 0.05); // 95Hz -> 65Hz
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.55 * Math.sin(2 * Math.PI * (pf * 0.5) * tk); // sub octave for weight
    buf[impactStart + k] += body * env * 0.95;
  }
}

// (c) bright metallic ring -- gold-on-gold clang character, layered above
// the boom
{
  const len = Math.floor(0.45 * SR);
  const ringFreqs = [920, 1380, 2050]; // inharmonic-ish partials for a metallic timbre
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.09) * (1 - Math.exp(-tk / 0.003));
    let ring = 0;
    for (const [idx, f] of ringFreqs.entries()) {
      ring += Math.sin(2 * Math.PI * f * tk) * (1 / (idx + 1));
    }
    buf[impactStart + k] += ring * env * 0.16;
  }
}

// (d) one short soft echo for a touch of space
{
  const delay = 0.11;
  const ds = impactStart + Math.floor(delay * SR);
  const len = Math.floor(0.3 * SR);
  for (let k = 0; k < len && ds + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.09);
    const pf = 60 + 12 * Math.exp(-tk / 0.04);
    buf[ds + k] += Math.sin(2 * Math.PI * pf * tk) * env * 0.18;
  }
}

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.95 / peak : 1;
const fadeStart = Math.floor((DUR - 0.1) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.15); // soft-clip for warmth
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
writeFileSync(new URL("./assets/impact.wav", import.meta.url), out);
console.log(`wrote assets/impact.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
