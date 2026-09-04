// Deterministic WAV bed for the "$200,000,000,000" molten gold pour.
// 4.5s, 48kHz, 16-bit mono. No dependencies. Seeded (mulberry32) — no Math.random.
//
// Sound design, authored to the same frames as the picture:
//   0.00-1.50s  rising molten shimmer as the gold pours in
//   2.00s (f48) SUB-BOOM — bound to the cool/settle, VO "$200 billion"
//   2.00-4.30s  weighty resonant decay into a somber sustained bed
//   4.30-4.50s  bed held, no fade — a hard, cuttable tail (tiny declick only)
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 4.5;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const BOOM_T = 48 / 24; // 2.0s — cool / sync frame

let seed = 0x1a2b3c4d >>> 0;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
}

const smooth = (a, b, t) => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
};
const clamp = (x) => Math.max(-1, Math.min(1, x));

let lp = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;

  // rising sub swell into the boom
  const swellEnv = smooth(0.0, BOOM_T, t) * (1 - smooth(BOOM_T - 0.03, BOOM_T + 0.06, t));
  const swf = 34 + 12 * smooth(0.0, BOOM_T, t);
  s += Math.sin(2 * Math.PI * swf * t) * swellEnv * 0.16;
  // rising noise texture, low-passed
  if (swellEnv > 0) {
    lp += (0.03 + 0.16 * smooth(0.1, BOOM_T, t)) * (rnd() * 2 - lp);
    s += lp * swellEnv * 0.1;
  }

  // somber sustained bed after the boom (slow beating drone, restrained)
  if (t > BOOM_T) {
    const bedEnv = smooth(BOOM_T + 0.2, BOOM_T + 0.8, t) * (1 - smooth(4.45, 4.5, t) * 0.15);
    const beat = 0.62 + 0.38 * Math.sin(2 * Math.PI * 0.22 * (t - BOOM_T));
    s += Math.sin(2 * Math.PI * 46 * t) * bedEnv * beat * 0.06;
    s += Math.sin(2 * Math.PI * 69 * t) * bedEnv * beat * 0.02;
  }

  buf[i] = s;
}

// --- SUB-BOOM at f13 ---
const b0 = Math.floor(BOOM_T * SR);
// attack transient
{
  let click = 0;
  const len = Math.floor(0.03 * SR);
  for (let k = 0; k < len && b0 + k < N; k++) {
    const env = Math.exp(-k / (0.005 * SR));
    click += 0.4 * (rnd() * 2 - click);
    buf[b0 + k] += click * env * 0.85;
  }
}
// body: deep sine with pitch drop (kinetic weight)
{
  const len = Math.floor(1.4 * SR);
  for (let k = 0; k < len && b0 + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.42);
    const pf = 44 + 40 * Math.exp(-tk / 0.05); // ~84Hz -> ~44Hz
    let body = Math.sin(2 * Math.PI * pf * tk);
    body += 0.45 * Math.sin(2 * Math.PI * pf * 0.5 * tk); // sub octave
    buf[b0 + k] += body * env * 0.95;
  }
}
// resonant tail
{
  const len = Math.floor(1.0 * SR);
  const rf = 120;
  for (let k = 0; k < len && b0 + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.4) * (1 - Math.exp(-tk / 0.006));
    buf[b0 + k] += (Math.sin(2 * Math.PI * rf * tk) + 0.4 * Math.sin(2 * Math.PI * rf * 2.0 * tk)) * env * 0.1;
  }
}

// --- normalize + soft-clip; tiny declick at the very end (no musical fade) ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.92 / peak : 1;
const declick = Math.floor(0.004 * SR);
for (let i = 0; i < N; i++) {
  let v = Math.tanh(buf[i] * norm * 1.1);
  if (i >= N - declick) v *= (N - i) / declick;
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
for (let i = 0; i < N; i++) out.writeInt16LE(Math.round(buf[i] * 32767), 44 + i * bytesPerSample);
writeFileSync(new URL("./assets/bed.wav", import.meta.url), out);
console.log(`wrote assets/bed.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
