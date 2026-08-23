// Deterministic WAV synth for the oxblood countdown.
// 5.0s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design:
//   0.00-1.00s  digit-assembly ticks (soft wooden clicks as digits land)
//   0.80-4.25s  cinematic tension riser (rising noise swell + sub drone)
//   4.25s       HOLLOW FINAL THUD when the counter hits $0 and cracks
//   4.25-5.00s  hollow resonant tail decaying into a dead stop
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 5.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const THUD_T = 4.25; // moment the counter hits zero

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

// one-pole low-pass state for the riser swell
let lp = 0;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;

  // --- sub drone: slow rising pitch, builds tension under the count ---
  if (t < THUD_T + 0.05) {
    const droneEnv = 0.14 * smooth(0.6, 4.0, t) * (1 - smooth(THUD_T - 0.15, THUD_T + 0.05, t) * 0.4);
    const freq = 38 + 10 * smooth(1.0, THUD_T, t); // 38 -> 48 Hz
    s += Math.sin(2 * Math.PI * freq * t) * droneEnv;
    // faint 5th above for body
    s += Math.sin(2 * Math.PI * freq * 1.5 * t) * droneEnv * 0.25;
  }

  // --- rising noise swell (whoosh) that peaks right before the thud ---
  const swellEnv = smooth(0.8, THUD_T, t) * (1 - smooth(THUD_T - 0.05, THUD_T + 0.1, t));
  if (swellEnv > 0) {
    const white = rnd() * 2;
    // rising low-pass cutoff => gets brighter as tension climbs
    const cutoff = 0.02 + 0.20 * smooth(0.8, THUD_T, t);
    lp += cutoff * (white - lp);
    s += lp * swellEnv * 0.16;
  }

  buf[i] = s;
}

// --- digit-assembly ticks (soft wooden clicks) ---
const tickTimes = [0.18, 0.30, 0.42, 0.52, 0.62, 0.72, 0.82, 0.92];
for (const tt of tickTimes) {
  const start = Math.floor(tt * SR);
  const len = Math.floor(0.05 * SR);
  const f = 320 + rnd() * 60;
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.010 * SR));
    const body = Math.sin(2 * Math.PI * f * (k / SR)) * 0.6 + rnd() * 0.5;
    buf[start + k] += body * env * 0.10;
  }
}

// --- HOLLOW FINAL THUD ---
const thudStart = Math.floor(THUD_T * SR);

// (a) attack transient: short filtered noise click
{
  let click = 0;
  const len = Math.floor(0.03 * SR);
  for (let k = 0; k < len && thudStart + k < N; k++) {
    const env = Math.exp(-k / (0.006 * SR));
    click += 0.35 * (rnd() * 2 - click); // quick LP on noise
    buf[thudStart + k] += click * env * 0.9;
  }
}

// (b) the thud body: detuned low sines with pitch drop (hollow, weighty)
{
  const len = Math.floor(1.1 * SR);
  for (let k = 0; k < len && thudStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.28); // fast-ish decay = "dead stop"
    // pitch drops from ~78Hz to ~52Hz for a falling, hollow weight
    const pf = 52 + 26 * Math.exp(-tk / 0.06);
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.5 * Math.sin(2 * Math.PI * (pf * 0.75) * tk); // sub-octave-ish, detuned -> hollowness
    buf[thudStart + k] += body * env * 0.85;
  }
}

// (c) hollow resonance: a ringing band that gives the empty, cavernous tail
{
  const len = Math.floor(0.9 * SR);
  const ringF = 138; // hollow wooden resonance
  for (let k = 0; k < len && thudStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.34) * (1 - Math.exp(-tk / 0.008));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.4 * Math.sin(2 * Math.PI * ringF * 2.01 * tk);
    buf[thudStart + k] += ring * env * 0.14;
  }
}

// (d) two soft echoes -> hollow cavern feel, decaying into dead silence
for (const [delay, gain] of [[0.16, 0.22], [0.33, 0.10]]) {
  const ds = thudStart + Math.floor(delay * SR);
  const len = Math.floor(0.7 * SR);
  for (let k = 0; k < len && ds + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.22);
    const pf = 50 + 8 * Math.exp(-tk / 0.05);
    buf[ds + k] += Math.sin(2 * Math.PI * pf * tk) * env * gain;
  }
}

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.92 / peak : 1;
const fadeStart = Math.floor((DUR - 0.12) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.1); // soft-clip for warmth
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
writeFileSync(new URL("./assets/thud.wav", import.meta.url), out);
console.log(`wrote assets/thud.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
