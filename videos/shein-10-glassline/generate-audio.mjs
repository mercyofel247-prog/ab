// Deterministic WAV synth for shein_10_glassline.
// 3.0s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design — ONE sync frame, f38 (~1.5833s @ 24fps):
//   0.00-1.55s   near-silence, a faint room tone under the establish/select beats
//   1.5833s      soft glass-resonance tick (bright, short) + low confirming thud,
//                landing together on the exact frame the silhouette locks and the
//                spike-line completes its draw
//   1.58-3.00s   quick decay into a quiet, alive hold — never dead silence
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 3.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const FPS = 24;
const SYNC_T = 38 / FPS; // f38 — 1.58333...s

// --- deterministic pseudo-noise (mulberry32) ---
let seed = 0x5eed1234 >>> 0;
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

// --- faint room tone under the whole shot: barely-there filtered noise ---
let lp = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const white = rnd() * 2;
  lp += 0.01 * (white - lp);
  const env = 0.012 * (1 - smooth(DUR - 0.15, DUR, t));
  buf[i] += lp * env;
}

// --- glass-resonance tick: bright, short, glassy chime ---
{
  const start = Math.floor(SYNC_T * SR);
  const len = Math.floor(0.22 * SR);
  const partials = [2600, 3900, 5200]; // fundamental + overtones -> "glass" timbre
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.05);
    let s = 0;
    for (let p = 0; p < partials.length; p++) {
      s += Math.sin(2 * Math.PI * partials[p] * tk) * (1 / (p + 1));
    }
    buf[start + k] += s * env * 0.16;
  }
}

// --- low confirming thud: short filtered click + a weighty, hollow body ---
{
  const start = Math.floor(SYNC_T * SR);

  // (a) attack transient
  let click = 0;
  const clickLen = Math.floor(0.02 * SR);
  for (let k = 0; k < clickLen && start + k < N; k++) {
    const env = Math.exp(-k / (0.005 * SR));
    click += 0.4 * (rnd() * 2 - click);
    buf[start + k] += click * env * 0.7;
  }

  // (b) the thud body: detuned low sines, quick confirming decay
  const bodyLen = Math.floor(0.45 * SR);
  for (let k = 0; k < bodyLen && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.16);
    const pf = 92 + 20 * Math.exp(-tk / 0.05);
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.45 * Math.sin(2 * Math.PI * (pf * 0.75) * tk);
    buf[start + k] += body * env * 0.7;
  }

  // (c) hollow resonance tail, keeps the hold alive rather than dead
  const ringLen = Math.floor(0.6 * SR);
  const ringF = 158;
  for (let k = 0; k < ringLen && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.3) * (1 - Math.exp(-tk / 0.006));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.35 * Math.sin(2 * Math.PI * ringF * 2.02 * tk);
    buf[start + k] += ring * env * 0.1;
  }
}

// --- normalize + gentle soft-clip, tiny fade at the very end to avoid a click ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
const fadeStart = Math.floor((DUR - 0.05) * SR);
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
writeFileSync(new URL("./assets/glassline-sfx.wav", import.meta.url), out);
console.log(`wrote assets/glassline-sfx.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz, sync=${SYNC_T.toFixed(4)}s)`);
