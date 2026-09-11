// Deterministic WAV synth for shot 08 — iris-open + land.
// 3.2s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design (bound to the ONE sync frame, f34 / 1.4s — the iris snap/land):
//   0.00-1.15s  near-silent low ambience, die-settle tick at ~0.05s
//   1.15-1.40s  soft mechanical iris-close whoosh (dark, filtered — NOT bright)
//   1.40s       low sub-thud impact, synced to the iris locking open
//   1.40-1.70s  hollow mechanical resonance tail
//   1.70-2.90s  faint sustained breathing hum (matches the ring's ±6% opacity breathe)
//   2.90-3.20s  tapers to true silence for a clean hard cut
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 3.2;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const IMPACT_T = 1.4; // f34 — the one sync frame (iris snap / land)

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

// one-pole low-pass state for the whoosh (kept dark/muffled — small cutoff)
let lp = 0;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;

  // --- near-silent low ambience under the die-settle ---
  const ambEnv = 0.02 * smooth(0.0, 0.3, t) * (1 - smooth(1.1, 1.4, t));
  s += Math.sin(2 * Math.PI * 44 * t) * ambEnv;

  // --- soft mechanical iris-close whoosh: dark, filtered noise swell into impact ---
  const whooshEnv = smooth(1.15, IMPACT_T, t) * (1 - smooth(IMPACT_T - 0.02, IMPACT_T + 0.06, t));
  if (whooshEnv > 0) {
    const white = rnd() * 2;
    const cutoff = 0.03 + 0.05 * smooth(1.15, IMPACT_T, t); // stays dark/muffled, never bright
    lp += cutoff * (white - lp);
    s += lp * whooshEnv * 0.12;
  }

  // --- sustained breathing hum, 1.7-2.9s, mirrors the ring's ±6% opacity breathe ---
  if (t > 1.7 && t < 2.9) {
    const breathe = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * (t - 1.7));
    const susEnv = 0.035 * smooth(1.7, 1.9, t) * (1 - smooth(2.7, 2.9, t)) * (0.5 + 0.5 * breathe);
    s += Math.sin(2 * Math.PI * 50 * t) * susEnv;
  }

  buf[i] = s;
}

// --- die-settle tick (soft, subordinate — the guess that lands and commits) ---
{
  const start = Math.floor(0.05 * SR);
  const len = Math.floor(0.05 * SR);
  const f = 300 + rnd() * 40;
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.011 * SR));
    const body = Math.sin(2 * Math.PI * f * (k / SR)) * 0.5 + rnd() * 0.4;
    buf[start + k] += body * env * 0.07;
  }
}

// --- IMPACT at f34 / 1.4s: mechanical snap + low sub-thud (not a bright whoosh) ---
const impactStart = Math.floor(IMPACT_T * SR);

// (a) muffled mechanical click — the aperture locking into place
{
  let click = 0;
  const len = Math.floor(0.025 * SR);
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const env = Math.exp(-k / (0.005 * SR));
    click += 0.22 * (rnd() * 2 - click); // heavier LP than a bright click -> dark, mechanical
    buf[impactStart + k] += click * env * 0.55;
  }
}

// (b) low sub-thud body: detuned low sines, quick punchy decay
{
  const len = Math.floor(0.6 * SR);
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.22);
    const pf = 70 + 30 * Math.exp(-tk / 0.05); // pitch drop, weighty
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.45 * Math.sin(2 * Math.PI * (pf * 0.5) * tk); // sub-octave weight
    buf[impactStart + k] += body * env * 0.8;
  }
}

// (c) hollow mechanical resonance ring, brief tail
{
  const len = Math.floor(0.35 * SR);
  const ringF = 162;
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.14) * (1 - Math.exp(-tk / 0.006));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.35 * Math.sin(2 * Math.PI * ringF * 1.98 * tk);
    buf[impactStart + k] += ring * env * 0.1;
  }
}

// --- normalize + gentle soft-clip, fade the very tail to true silence (clean hard cut) ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
const fadeStart = Math.floor((DUR - 0.15) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.05); // soft-clip for warmth
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
writeFileSync(new URL("./assets/iris-land.wav", import.meta.url), out);
console.log(`wrote assets/iris-land.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
