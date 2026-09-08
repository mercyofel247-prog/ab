// Deterministic WAV synth for the $5 hero-number reveal.
// 3.0s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design:
//   1.250s  soft LOW specular "shhk" sub-tick — the rack-snap sync frame (f30).
//           A dull, low-passed noise burst with a fast decay, not a bright whoosh.
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 3.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const TICK_T = 1.25; // frame 30 @ 24fps

// --- deterministic pseudo-noise (mulberry32) ---
let seed = 0x5f3a9d21 >>> 0;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; // -0.5..0.5
}

const clamp = (x) => Math.max(-1, Math.min(1, x));

// --- soft low specular "shhk" — low-passed noise burst, fast decay ---
{
  const start = Math.floor(TICK_T * SR);
  const len = Math.floor(0.11 * SR);
  let lp = 0;
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.028) * (1 - Math.exp(-tk / 0.002));
    const white = rnd() * 2;
    // gently rising cutoff for the first few ms, then closing — keeps it low/dull, never bright
    const cutoff = 0.05 + 0.03 * Math.exp(-tk / 0.015);
    lp += cutoff * (white - lp);
    buf[start + k] += lp * env * 0.55;
  }
  // a low body thump under the noise, so it reads as "specular" not "hiss"
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.02);
    const f = 96 - 30 * tk / 0.11;
    buf[start + k] += Math.sin(2 * Math.PI * Math.max(60, f) * tk) * env * 0.18;
  }
}

// --- normalize + gentle soft-clip ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.85 / peak : 1;
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.05);
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
writeFileSync(new URL("./assets/shhk.wav", import.meta.url), out);
console.log(`wrote assets/shhk.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
