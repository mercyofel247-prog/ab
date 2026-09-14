// Deterministic WAV synth for shein_12_scale.
// 2.75s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design — ONE sync frame, f34 (1.41667s @ 24fps, "year"):
//   0.00-1.42s   near-silence, the climb builds with no audio cue
//   1.4167s      a deep SUB-BOOM — dark, weighty, no bright transient —
//                landing on "year" as the tower's climb hits impact
//   1.42-2.75s   a long sub-rumble tail, decaying but never dead
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 2.75;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const FPS = 24;
const SYNC_T = 34 / FPS; // f34 — 1.41667s

// --- deterministic pseudo-noise (mulberry32) ---
let seed = 0x12c5ca1e >>> 0;
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

const start = Math.floor(SYNC_T * SR);

// (a) sub-boom body: a low, dark sine with a fast pitch drop — no bright click.
{
  const len = Math.floor(1.2 * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const attack = 1 - Math.exp(-tk / 0.008); // soft, not a hard transient
    const env = attack * Math.exp(-tk / 0.42);
    const pf = 46 + 18 * Math.exp(-tk / 0.09); // 64Hz -> 46Hz, dark
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.4 * Math.sin(2 * Math.PI * (pf * 0.5) * tk); // sub-octave weight
    buf[start + k] += body * env * 0.95;
  }
}

// (b) low filtered thump-noise, dulled (heavily low-passed) — body, not brightness.
{
  let lp = 0;
  const len = Math.floor(0.25 * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.05);
    const white = rnd() * 2;
    lp += 0.03 * (white - lp); // heavy low-pass -> dull, never bright
    buf[start + k] += lp * env * 0.5;
  }
}

// (c) long sub-rumble tail — keeps the hold alive rather than going dead.
{
  const len = Math.floor(1.3 * SR);
  const ringF = 33;
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.55) * (1 - Math.exp(-tk / 0.02));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.3 * Math.sin(2 * Math.PI * ringF * 1.5 * tk);
    buf[start + k] += ring * env * 0.22;
  }
}

// --- faint room tone under the whole shot ---
{
  let lp2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const white = rnd() * 2;
    lp2 += 0.008 * (white - lp2);
    const env = 0.01 * (1 - smooth(DUR - 0.12, DUR, t));
    buf[i] += lp2 * env;
  }
}

// --- normalize + gentle soft-clip, tiny fade at the very end to avoid a click ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.92 / peak : 1;
const fadeStart = Math.floor((DUR - 0.05) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.05);
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
writeFileSync(new URL("./assets/scale-sfx.wav", import.meta.url), out);
console.log(`wrote assets/scale-sfx.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz, sync=${SYNC_T.toFixed(4)}s)`);
