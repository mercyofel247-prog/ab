// Deterministic WAV synth for the $5 fracture / shatter-seam impact.
// 2.6s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design:
//   0.00-1.417s  low sub-drone building tension under the hold
//   1.417s (f34) low matched impact (sub-boom, NOT a bright whoosh) + a soft
//                light-leak bloom "wash" riding under it, on the VO word
//                "dangerous"
//   1.417-2.2s   camera-shake sub-rumble tail, decaying into the sustained hold
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 2.6;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const IMPACT_T = 34 / 24; // sync frame 34

// --- deterministic pseudo-noise (mulberry32) ---
let seed = 0x2b1e7f4a >>> 0;
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

// --- low sub-drone building under the tension hold ---
let lp = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  if (t < IMPACT_T - 0.02) {
    const env = 0.1 * smooth(0.1, IMPACT_T - 0.05, t);
    const freq = 34 + 6 * smooth(0.3, IMPACT_T, t);
    buf[i] += Math.sin(2 * Math.PI * freq * t) * env;
  }
  // a very faint noise "wash" building right into the impact (light-leak bloom)
  const washEnv = smooth(IMPACT_T - 0.25, IMPACT_T, t) * (1 - smooth(IMPACT_T - 0.02, IMPACT_T + 0.05, t));
  if (washEnv > 0) {
    const white = rnd() * 2;
    lp += 0.08 * (white - lp);
    buf[i] += lp * washEnv * 0.1;
  }
}

// --- LOW MATCHED IMPACT: sub-boom, not a bright whoosh ---
const impactStart = Math.floor(IMPACT_T * SR);
{
  const len = Math.floor(0.9 * SR);
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.32) * (1 - Math.exp(-tk / 0.006));
    const f = 58 * Math.exp(-tk / 0.5); // deep, falling pitch
    let s = Math.sin(2 * Math.PI * f * tk) * 0.85;
    s += Math.sin(2 * Math.PI * f * 0.5 * tk) * 0.3; // sub octave, body
    buf[impactStart + k] += s * env * 0.5;
  }
}

// --- camera-shake sub-rumble tail (low, rattly, decaying) ---
{
  const len = Math.floor(0.8 * SR);
  let rlp = 0;
  for (let k = 0; k < len && impactStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.28) * smooth(0, 0.03, tk);
    const white = rnd() * 2;
    rlp += 0.06 * (white - rlp);
    buf[impactStart + k] += rlp * env * 0.22;
  }
}

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
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
