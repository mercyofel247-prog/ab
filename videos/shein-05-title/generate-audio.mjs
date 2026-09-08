// Deterministic WAV synth for the SHEIN title-drop.
// 3.4s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design:
//   0.00-0.50s  SCORED SILENCE — the vacuum. The loudest silence is the frame
//               before the hit (nothing plays here at all).
//   0.50s (f12) HEAVY SLAM: an SFX-drop + deep sub-boom + a dust-puff impact all
//               land together on the VO word "Shein" — a sub-boom, NOT a bright
//               whoosh.
//   0.50-1.4s   sub-boom body + a short dusty-air tail decaying into the sustain
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 3.4;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const SLAM_T = 12 / 24; // sync frame 12 = 500ms

// --- deterministic pseudo-noise (mulberry32) ---
let seed = 0x7f4a2b1e >>> 0;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; // -0.5..0.5
}

const clamp = (x) => Math.max(-1, Math.min(1, x));

const slamStart = Math.floor(SLAM_T * SR);

// --- DEEP SUB-BOOM (the impose slam) ---
{
  const len = Math.floor(1.0 * SR);
  for (let k = 0; k < len && slamStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.38) * (1 - Math.exp(-tk / 0.004));
    const f = 62 * Math.exp(-tk / 0.45); // deep, falling
    let s = Math.sin(2 * Math.PI * f * tk) * 0.9;
    s += Math.sin(2 * Math.PI * f * 0.5 * tk) * 0.35; // sub octave for weight
    buf[slamStart + k] += s * env * 0.55;
  }
}

// --- SFX-DROP transient click at the very front of the slam (short, low-mid) ---
{
  const len = Math.floor(0.05 * SR);
  for (let k = 0; k < len && slamStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.012);
    const body = Math.sin(2 * Math.PI * 180 * tk) * 0.5 + rnd() * 0.6;
    buf[slamStart + k] += body * env * 0.22;
  }
}

// --- DUST-PUFF: a soft low-passed noise burst, quick decay ---
{
  const len = Math.floor(0.4 * SR);
  let lp = 0;
  for (let k = 0; k < len && slamStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.14) * (1 - Math.exp(-tk / 0.003));
    const white = rnd() * 2;
    lp += 0.07 * (white - lp); // low-passed => dusty air, not bright hiss
    buf[slamStart + k] += lp * env * 0.3;
  }
}

// --- sub-rumble tail (settles the slam into the sustained hold) ---
{
  const len = Math.floor(0.8 * SR);
  let rlp = 0;
  for (let k = 0; k < len && slamStart + Math.floor(0.1 * SR) + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.3) * (tk < 0.02 ? tk / 0.02 : 1);
    const white = rnd() * 2;
    rlp += 0.05 * (white - rlp);
    buf[slamStart + Math.floor(0.1 * SR) + k] += rlp * env * 0.14;
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
writeFileSync(new URL("./assets/slam.wav", import.meta.url), out);
console.log(`wrote assets/slam.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
