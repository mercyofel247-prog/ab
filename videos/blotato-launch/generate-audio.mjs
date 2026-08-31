// Deterministic WAV synth for blotato-launch's sound design.
// 25.0s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design: a soft ambient rise under the cold open, a gentle chime as
// the wordmark settles, a quiet whoosh at each scene transition, a light
// tick as each UI element lands, and a warm chime when the CTA button
// finishes assembling. Everything stays quiet relative to the VO -- this is
// texture, not a music bed.
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 25.0; // must match index.html's composition duration exactly
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

// --- timing constants (must match index.html exactly) ---
const OPEN_SETTLE = 1.8;
const REVEAL_VO = 2.5, REVEAL_DUR = 1.365;
const T1 = REVEAL_VO + REVEAL_DUR + 0.435; // 4.3
const B1_VO = T1, B1_DUR = 3.755;
const T2 = B1_VO + B1_DUR + 0.545; // 8.6
const B2_VO = T2, B2_DUR = 3.691;
const T3 = B2_VO + B2_DUR + 0.509; // 12.8
const B3_VO = T3, B3_DUR = 3.072;
const T4 = B3_VO + B3_DUR + 0.728; // 16.6
const CTA_VO = T4, CTA_DUR = 3.157;

function addSample(i, v) {
  if (i >= 0 && i < N) buf[i] += v;
}

// soft rising ambient swell (filtered noise), a gentle bed under the open
function ambientRise(startSec, endSec, peakGain = 0.05) {
  let lp = 0;
  const s = Math.floor(startSec * SR), e = Math.floor(endSec * SR);
  for (let i = s; i < e && i < N; i++) {
    const t = (i - s) / (e - s);
    const env = Math.sin(Math.PI * Math.min(t * 1.3, 1)); // rises, doesn't sharply cut
    const white = rnd() * 2;
    lp += 0.04 * (white - lp);
    buf[i] += lp * env * peakGain;
  }
}

// short UI whoosh leading into a scene transition
function whoosh(startSec, endSec, peakGain = 0.09) {
  let lp = 0;
  const s = Math.floor(startSec * SR), e = Math.floor(endSec * SR);
  for (let i = s; i < e && i < N; i++) {
    const t = (i - s) / (e - s);
    const env = Math.sin(Math.PI * t);
    const white = rnd() * 2;
    lp += 0.15 * (white - lp);
    buf[i] += lp * env * peakGain;
  }
}

// light high-passed tick as a UI element lands
function tick(atSec, gain = 0.1) {
  const start = Math.floor(atSec * SR);
  let prev = 0;
  const len = Math.floor(0.02 * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.004 * SR));
    const white = rnd() * 2;
    const hp = white - prev;
    prev = white;
    addSample(start + k, hp * env * gain);
  }
}

// gentle chime (consonant sine partials, soft attack) -- for the wordmark
// settle and the CTA button landing
function chime(atSec, gain = 0.35, partials = [523, 784, 1046]) {
  const start = Math.floor(atSec * SR);
  const len = Math.floor(0.6 * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.26) * (1 - Math.exp(-tk / 0.006));
    let s = 0;
    for (const [i, f] of partials.entries()) s += Math.sin(2 * Math.PI * f * tk) / (i + 1);
    addSample(start + k, s * env * gain);
  }
}

// --- lay in the events ---
ambientRise(0, OPEN_SETTLE, 0.05);
chime(OPEN_SETTLE, 0.3, [523, 784, 1046]); // wordmark settle -- soft, not a boom

whoosh(T1 - 0.4, T1, 0.08);
[0, 1, 2, 3].forEach((i) => tick(T1 + 0.8 + i * 0.3, 0.09));

whoosh(T2 - 0.4, T2, 0.08);
[0, 1, 2].forEach((i) => tick(T2 + 1.3 + i * 0.25, 0.08));

whoosh(T3 - 0.4, T3, 0.08);
[0, 1, 2, 3].forEach((i) => tick(T3 + 0.3 + i * 0.15, 0.07));

whoosh(T4 - 0.5, T4, 0.09);
chime(CTA_VO + CTA_DUR, 0.4, [523, 659, 784, 1046]); // CTA button lands -- warmer, fuller chord

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.85 / peak : 1;
const fadeStart = Math.floor((DUR - 0.15) * SR);
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
writeFileSync(new URL("./assets/sfx.wav", import.meta.url), out);
console.log(`wrote assets/sfx.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
