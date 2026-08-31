// Deterministic WAV synth for the -$958,000,000 odometer card's one SFX
// beat: a deep sub-boom landing on the cut right after the number arrives.
// 2.4s, 48kHz, 16-bit mono. No dependencies.
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 2.4; // must match index.html's composition duration exactly
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

// --- deterministic pseudo-noise (mulberry32) -- NEVER Math.random() ---
let seed = 0x9e3779b9 >>> 0;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; // -0.5..0.5
}
const clamp = (x) => Math.max(-1, Math.min(1, x));

// arrival at 1.2s (ROLL_DUR in index.html); the boom lands just after, on
// the cut out of this card
const BOOM_T = 1.3;

function addSample(i, v) {
  if (i >= 0 && i < N) buf[i] += v;
}

// deep sub-boom: a pitched-down sine thump (85Hz -> 38Hz over the attack)
// plus a low-passed noise body for weight, one long exponential decay
function subBoom(atSec, gain = 0.9) {
  const start = Math.floor(atSec * SR);
  const len = Math.floor(1.05 * SR);
  let lp = 0;
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.38);
    const pitch = 38 + 47 * Math.exp(-tk / 0.09); // 85Hz -> 38Hz sweep
    const phase = 2 * Math.PI * pitch * tk;
    const tone = Math.sin(phase);
    const white = rnd() * 2;
    lp += 0.08 * (white - lp); // low-pass for a dull sub rumble, not hiss
    const body = tone * 0.8 + lp * 0.35;
    addSample(start + k, body * env * gain);
  }
}

// a very short cold transient at the very front of the boom -- the "crack"
// of impact riding on top of the sub weight
function transient(atSec, gain = 0.35) {
  const start = Math.floor(atSec * SR);
  let prev = 0;
  const len = Math.floor(0.018 * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.003 * SR));
    const white = rnd() * 2;
    const hp = white - prev;
    prev = white;
    addSample(start + k, hp * env * gain);
  }
}

subBoom(BOOM_T, 0.9);
transient(BOOM_T, 0.32);

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
const fadeStart = Math.floor((DUR - 0.1) * SR);
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
writeFileSync(new URL("./assets/subboom.wav", import.meta.url), out);
console.log(`wrote assets/subboom.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
