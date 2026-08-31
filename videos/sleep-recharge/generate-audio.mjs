// Deterministic WAV synth for the sleep-recharge sting.
// 8.0s, 48kHz, 16-bit mono. No dependencies, no randomness.
//
// Sound design:
//   0.00-7.00s  soft rising pad (two detuned sines) — a slow, calm swell
//               that tracks the battery filling up
//   7.00s       gentle bell chime when the charge hits 100%
//   7.00-8.00s  shimmering decay tail into a quiet hold
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 8.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const FULL_T = 7.0; // moment the battery reads 100%

const clamp = (x) => Math.max(-1, Math.min(1, x));
const smooth = (a, b, t) => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
};

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;

  // --- calm pad: two detuned low sines, swelling in as the fill rises ---
  if (t < FULL_T + 0.15) {
    const padEnv =
      0.16 * smooth(0.3, 3.0, t) * (1 - smooth(FULL_T - 0.2, FULL_T + 0.1, t) * 0.55);
    const f1 = 110; // A2
    const f2 = 110 * Math.pow(2, 7 / 12); // fifth above, E3
    s += Math.sin(2 * Math.PI * f1 * t) * padEnv * 0.6;
    s += Math.sin(2 * Math.PI * f2 * t) * padEnv * 0.4;
    // gentle octave shimmer that grows toward the end of the fill
    const shimmerEnv = 0.05 * smooth(4.0, FULL_T, t);
    s += Math.sin(2 * Math.PI * f1 * 2 * t) * shimmerEnv;
  }

  // --- full-charge bell: a few clean sine partials, fast attack, slow decay ---
  if (t >= FULL_T) {
    const dt = t - FULL_T;
    const bellEnv = smooth(0, 0.015, dt) * Math.exp(-dt * 2.4);
    const partials = [880, 1320, 1760, 2640]; // A5 + harmonics
    const weights = [0.5, 0.28, 0.14, 0.08];
    for (let p = 0; p < partials.length; p++) {
      s += Math.sin(2 * Math.PI * partials[p] * dt) * bellEnv * weights[p];
    }
  }

  buf[i] = clamp(s);
}

// --- encode 16-bit PCM mono WAV ---
const bytesPerSample = 2;
const blockAlign = bytesPerSample;
const byteRate = SR * blockAlign;
const dataSize = N * bytesPerSample;
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + dataSize, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(byteRate, 28);
header.writeUInt16LE(blockAlign, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(dataSize, 40);

const data = Buffer.alloc(dataSize);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(buf[i] * 32767), i * bytesPerSample);
}

writeFileSync(new URL("./assets/chime.wav", import.meta.url), Buffer.concat([header, data]));
console.log(`wrote assets/chime.wav (${DUR}s, ${SR}Hz, mono)`);
