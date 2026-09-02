// Deterministic WAV synth for "$42,000,000,000 — In One Day".
// 4.5s, 48kHz, 16-bit mono. No dependencies, no Math.random/Date.now.
//
// Authored to the same frames as the picture (24fps):
//   0.00-1.50s (f0-36)   notification-storm texture rising (thousands of thumb-taps)
//   1.50s      (f36)     BIG sub-boom — the solidify/impact sync frame
//   1.50-4.30s (f36-103) bed at rising peak through the hold
//   4.30-4.50s (f103-108) settle into the exit
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 4.5;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const BOOM_T = 1.5; // frame 36 — the hard boom lands here

// --- deterministic RNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x42b17700);

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

  // --- sub drone: slow rising pitch builds tension into the boom ---
  if (t < BOOM_T + 0.05) {
    const droneEnv = 0.13 * smooth(0.2, 1.4, t);
    const freq = 40 + 10 * smooth(0.2, BOOM_T, t); // 40 -> 50 Hz
    s += Math.sin(2 * Math.PI * freq * t) * droneEnv;
    s += Math.sin(2 * Math.PI * freq * 1.5 * t) * droneEnv * 0.22;
  }

  // --- rising noise swell peaking right before the boom ---
  const swellEnv = smooth(0.3, BOOM_T, t) * (1 - smooth(BOOM_T - 0.04, BOOM_T + 0.08, t));
  if (swellEnv > 0) {
    const white = rnd() * 2 - 1;
    const cutoff = 0.02 + 0.22 * smooth(0.3, BOOM_T, t);
    lp += cutoff * (white - lp);
    s += lp * swellEnv * 0.15;
  }

  // --- sustained bed after the boom: rising peak through the hold, settle at exit ---
  if (t >= BOOM_T) {
    const bedEnv =
      0.10 * smooth(BOOM_T, BOOM_T + 0.5, t) *
      (0.7 + 0.3 * smooth(BOOM_T, 4.3, t)) * // rising peak through the hold
      (1 - smooth(4.3, 4.5, t) * 0.85); // settle into the exit
    const bf = 46 + 6 * smooth(BOOM_T, 4.3, t);
    s += Math.sin(2 * Math.PI * bf * t) * bedEnv;
    s += Math.sin(2 * Math.PI * bf * 2.0 * t) * bedEnv * 0.18;
  }

  buf[i] = s;
}

// --- notification-storm: dense seeded thumb-taps rising in density 0 -> 1.5s ---
// each tap is a short high "tick"; density accelerates toward the boom.
{
  let t = 0.05;
  while (t < BOOM_T - 0.01) {
    const prog = t / BOOM_T; // 0 -> 1
    const start = Math.floor(t * SR);
    const len = Math.floor(0.018 * SR);
    const f = 1800 + rnd() * 2600; // bright phone-notification chirp
    const amp = 0.05 + 0.11 * prog; // louder/denser as the storm builds
    const pan = 1; // mono
    for (let k = 0; k < len && start + k < N; k++) {
      const env = Math.exp(-k / (0.004 * SR));
      const body = Math.sin(2 * Math.PI * f * (k / SR)) * 0.7 + (rnd() * 2 - 1) * 0.3;
      buf[start + k] += body * env * amp * pan;
    }
    // gap shrinks as density rises (0.11s -> ~0.012s)
    const gap = 0.11 - 0.098 * prog;
    t += Math.max(0.012, gap * (0.6 + rnd() * 0.8));
  }
}

// --- BIG sub-boom at frame 36 ---
const boomStart = Math.floor(BOOM_T * SR);

// (a) attack transient
{
  let click = 0;
  const len = Math.floor(0.03 * SR);
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const env = Math.exp(-k / (0.006 * SR));
    click += 0.4 * (rnd() * 2 - 1 - click);
    buf[boomStart + k] += click * env * 0.9;
  }
}

// (b) boom body: detuned low sines with a pitch drop for weight
{
  const len = Math.floor(1.3 * SR);
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.34);
    const pf = 54 + 30 * Math.exp(-tk / 0.07); // ~84Hz -> ~54Hz
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.5 * Math.sin(2 * Math.PI * (pf * 0.75) * tk);
    buf[boomStart + k] += body * env * 0.9;
  }
}

// (c) impact resonance ring
{
  const len = Math.floor(0.8 * SR);
  const ringF = 150;
  for (let k = 0; k < len && boomStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.3) * (1 - Math.exp(-tk / 0.006));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.4 * Math.sin(2 * Math.PI * ringF * 2.01 * tk);
    buf[boomStart + k] += ring * env * 0.12;
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
writeFileSync(new URL("./assets/boom.wav", import.meta.url), out);
console.log(`wrote assets/boom.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
