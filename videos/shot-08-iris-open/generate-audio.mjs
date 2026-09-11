// Deterministic WAV synth for the iris-open land.
// 3.2s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design (bound to the ONE sync frame, f34 = 1.41667s @ 24fps):
//   0.00-1.25s   near silence, faint mechanical idle hum
//   1.25-1.417s  soft mechanical iris-close whoosh (low/mid filtered noise, NOT bright/airy)
//   1.417s       low sub-thud — the eye locks open (matches the rack-snap/land beat)
//   1.417-2.4s   hollow resonant tail decaying into a dead stop
//   2.4-3.2s     silence, holding the cut
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 3.2;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const THUD_T = 34 / 24; // 1.41667s — sync frame f34, matches the timeline's rack-snap/land beat

// --- deterministic pseudo-noise (mulberry32) ---
let seed = 0x7a160e >>> 0; // seeded from the oxblood accent hex, deterministic and stable
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

// --- faint mechanical idle hum under the establish/aperture beats ---
for (let i = 0; i < N; i++) {
  const t = i / SR;
  if (t < THUD_T) {
    const env = 0.02 * smooth(0.0, 0.3, t) * (1 - smooth(THUD_T - 0.08, THUD_T, t));
    buf[i] += Math.sin(2 * Math.PI * 54 * t) * env;
  }
}

// --- soft mechanical iris-close whoosh: low/mid filtered noise swell, NOT bright ---
{
  const start = THUD_T - 0.167; // ~1.25s, arrives right before impact
  const startIdx = Math.floor(start * SR);
  const len = Math.floor((THUD_T - start) * SR);
  let lp = 0;
  for (let k = 0; k < len && startIdx + k < N; k++) {
    const tk = k / len;
    const env = Math.sin((Math.PI / 2) * tk); // rises into the impact
    const white = rnd() * 2;
    // low cutoff throughout — deliberately dull/mechanical, never brightens toward air
    const cutoff = 0.05 + 0.05 * tk;
    lp += cutoff * (white - lp);
    buf[startIdx + k] += lp * env * 0.22;
  }
}

// --- low sub-thud at THUD_T: the eye locks open ---
const thudStart = Math.floor(THUD_T * SR);

// (a) short filtered-noise attack click
{
  let click = 0;
  const len = Math.floor(0.025 * SR);
  for (let k = 0; k < len && thudStart + k < N; k++) {
    const env = Math.exp(-k / (0.006 * SR));
    click += 0.3 * (rnd() * 2 - click);
    buf[thudStart + k] += click * env * 0.75;
  }
}

// (b) sub body — low, weighty, fast dead-stop decay to suit the 3.2s shot
{
  const len = Math.floor(0.7 * SR);
  for (let k = 0; k < len && thudStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.2);
    const pf = 58 + 22 * Math.exp(-tk / 0.05); // pitch drop, low and hollow
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.45 * Math.sin(2 * Math.PI * (pf * 0.75) * tk);
    buf[thudStart + k] += body * env * 0.9;
  }
}

// (c) hollow resonant tail
{
  const len = Math.floor(0.6 * SR);
  const ringF = 150;
  for (let k = 0; k < len && thudStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.22) * (1 - Math.exp(-tk / 0.008));
    const ring = Math.sin(2 * Math.PI * ringF * tk) + 0.35 * Math.sin(2 * Math.PI * ringF * 2.02 * tk);
    buf[thudStart + k] += ring * env * 0.12;
  }
}

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.92 / peak : 1;
const fadeStart = Math.floor((DUR - 0.15) * SR);
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
writeFileSync(new URL("./assets/iris-land.wav", import.meta.url), out);
console.log(`wrote assets/iris-land.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
