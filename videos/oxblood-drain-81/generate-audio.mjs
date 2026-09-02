// Deterministic WAV bed for "81% — OF EVERY DOLLAR, GONE" (oxblood collapse).
// 5.0s, 48kHz, 16-bit mono. No dependencies. Seeded (mulberry32) — no Math.random.
//
// Sound design, authored to the same frames as the picture:
//   0.00-1.50s  low unease bed RISING under the drain (sub drone + climbing noise)
//   1.50s (f36) HARD sub-drop — the reveal / sweep-completion, "no cash left to give"
//   1.50-2.40s  the bed pulls back sharply toward near-silence (peak -> the drop into quiet)
//   2.40-4.80s  sustained near-silence (a bare, breathing hollow tone)
//   4.80-5.00s  near-silent exit into the cut
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 5.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const DROP_T = 1.5; // frame 36 — the peak / sub-drop

// deterministic pseudo-noise (mulberry32)
let seed = 0x9e3779b9 >>> 0;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
}

const clamp = (x) => Math.max(-1, Math.min(1, x));
const smooth = (a, b, t) => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
};

let lp = 0; // one-pole low-pass state for the riser

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;

  // --- rising unease drone under the drain, choked hard right after the drop ---
  const droneEnv =
    (0.05 + 0.12 * smooth(0.0, DROP_T, t)) * (1 - 0.82 * smooth(DROP_T, DROP_T + 0.9, t));
  const freq = 41 + 7 * smooth(0.2, DROP_T, t); // 41 -> 48 Hz
  s += Math.sin(2 * Math.PI * freq * t) * droneEnv;
  s += Math.sin(2 * Math.PI * freq * 1.5 * t) * droneEnv * 0.22;

  // --- climbing noise swell that peaks into the drop ---
  const swellEnv = smooth(0.5, DROP_T, t) * (1 - smooth(DROP_T - 0.04, DROP_T + 0.08, t));
  if (swellEnv > 0) {
    const cutoff = 0.02 + 0.2 * smooth(0.5, DROP_T, t);
    lp += cutoff * (rnd() * 2 - lp);
    s += lp * swellEnv * 0.14;
  }

  // --- sustained near-silence: a bare breathing hollow tone (2.4-4.8s) ---
  if (t > 2.2) {
    const hush = smooth(2.2, 2.7, t) * (1 - smooth(4.7, 5.0, t));
    const breath = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.28 * (t - 2.2));
    s += Math.sin(2 * Math.PI * 44 * t) * hush * breath * 0.02;
  }

  buf[i] = s;
}

// --- HARD sub-drop at f36 (1.5s): weighty, hollow, decays into the quiet ---
const dropStart = Math.floor(DROP_T * SR);
// (a) attack transient
{
  let click = 0;
  const len = Math.floor(0.03 * SR);
  for (let k = 0; k < len && dropStart + k < N; k++) {
    const env = Math.exp(-k / (0.006 * SR));
    click += 0.35 * (rnd() * 2 - click);
    buf[dropStart + k] += click * env * 0.8;
  }
}
// (b) sub body with pitch drop
{
  const len = Math.floor(1.1 * SR);
  for (let k = 0; k < len && dropStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.3);
    const pf = 50 + 28 * Math.exp(-tk / 0.06); // ~78Hz -> ~50Hz
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.5 * Math.sin(2 * Math.PI * pf * 0.75 * tk);
    buf[dropStart + k] += body * env * 0.9;
  }
}
// (c) hollow resonance tail
{
  const len = Math.floor(0.9 * SR);
  const ringF = 132;
  for (let k = 0; k < len && dropStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.34) * (1 - Math.exp(-tk / 0.008));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.4 * Math.sin(2 * Math.PI * ringF * 2.01 * tk);
    buf[dropStart + k] += ring * env * 0.12;
  }
}

// --- normalize + soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
const fadeStart = Math.floor((DUR - 0.16) * SR);
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
writeFileSync(new URL("./assets/bed.wav", import.meta.url), out);
console.log(`wrote assets/bed.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
