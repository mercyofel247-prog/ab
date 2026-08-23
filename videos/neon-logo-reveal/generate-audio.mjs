// Deterministic WAV synth for the neon logo reveal.
// 5.0s, 48kHz, 16-bit mono. No dependencies.
//
// Sound design:
//   0.00-0.45s  dark room tone, faint electrical hum fading up
//   0.45-1.75s  tube-startup flickers (buzzy zap ticks) as letters ignite
//   ~1.9s       power-on surge: a bright electric "thunk" as the sign locks on
//   1.9-5.0s    steady neon hum (60Hz + harmonics) with a slow shimmer, tiny
//               random flicker crackles, decaying gently at the very end
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 5.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

const SURGE_T = 1.9;

// deterministic pseudo-noise (mulberry32)
let seed = 0x1a2b3c4d >>> 0;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
}
const clamp = (x) => Math.max(-1, Math.min(1, x));
const smooth = (a, b, t) => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
};

// --- steady mains-style hum: 60Hz fundamental + harmonics ---
for (let i = 0; i < N; i++) {
  const t = i / SR;
  // hum fades in early, jumps up at the surge, holds, dips at the very end
  const preHum = 0.05 * smooth(0.1, 0.9, t);
  const onHum = 0.10 * smooth(SURGE_T - 0.05, SURGE_T + 0.2, t);
  const tail = 1 - 0.5 * smooth(DUR - 0.15, DUR, t);
  const amp = (preHum + onHum) * tail;
  // slow shimmer so the hum "breathes"
  const shimmer = 1 + 0.12 * Math.sin(2 * Math.PI * 0.8 * t);
  let s = 0;
  s += Math.sin(2 * Math.PI * 60 * t) * 1.0;
  s += Math.sin(2 * Math.PI * 120 * t) * 0.5;
  s += Math.sin(2 * Math.PI * 180 * t) * 0.28;
  s += Math.sin(2 * Math.PI * 240 * t) * 0.14;
  buf[i] += s * amp * shimmer;
}

// --- tube-startup flicker ticks (buzzy zaps as letters ignite) ---
const igniteTimes = [0.50, 0.72, 0.95, 1.18, 1.40, 1.60];
for (const tt of igniteTimes) {
  const start = Math.floor(tt * SR);
  const len = Math.floor(0.06 * SR);
  const f = 90 + rnd() * 120;
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.012 * SR));
    // buzzy: square-ish tone + noise
    const tone = Math.sign(Math.sin(2 * Math.PI * f * (k / SR))) * 0.5;
    buf[start + k] += (tone + rnd() * 0.9) * env * 0.09;
  }
}

// --- power-on surge: bright electric thunk when the sign locks on ---
{
  const start = Math.floor(SURGE_T * SR);
  // (a) transient crack
  let click = 0;
  const cl = Math.floor(0.025 * SR);
  for (let k = 0; k < cl && start + k < N; k++) {
    const env = Math.exp(-k / (0.005 * SR));
    click += 0.4 * (rnd() * 2 - click);
    buf[start + k] += click * env * 0.8;
  }
  // (b) low thunk body with quick pitch drop
  const bl = Math.floor(0.5 * SR);
  for (let k = 0; k < bl && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.13);
    const pf = 70 + 60 * Math.exp(-tk / 0.04);
    buf[start + k] += Math.sin(2 * Math.PI * pf * tk) * env * 0.6;
  }
  // (c) electric zap sweep up
  const zl = Math.floor(0.18 * SR);
  for (let k = 0; k < zl && start + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.05) * (1 - Math.exp(-tk / 0.004));
    const f = 400 + 2600 * (tk / (zl / SR));
    buf[start + k] += (Math.sin(2 * Math.PI * f * tk) * 0.5 + rnd() * 0.5) * env * 0.14;
  }
}

// --- tiny random flicker crackles across the steady phase ---
for (let c = 0; c < 5; c++) {
  const tt = SURGE_T + 0.4 + c * 0.55 + rnd() * 0.2;
  const start = Math.floor(tt * SR);
  if (start >= N) break;
  const len = Math.floor(0.02 * SR);
  for (let k = 0; k < len && start + k < N; k++) {
    const env = Math.exp(-k / (0.004 * SR));
    buf[start + k] += rnd() * env * 0.05;
  }
}

// --- normalize + soft-clip + end fade ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.9 / peak : 1;
const fadeStart = Math.floor((DUR - 0.1) * SR);
for (let i = 0; i < N; i++) {
  let v = Math.tanh(buf[i] * norm * 1.05);
  if (i >= fadeStart) v *= 1 - (i - fadeStart) / (N - fadeStart);
  buf[i] = clamp(v);
}

// --- write 16-bit PCM WAV ---
const dataSize = N * 2;
const out = Buffer.alloc(44 + dataSize);
out.write("RIFF", 0);
out.writeUInt32LE(36 + dataSize, 4);
out.write("WAVE", 8);
out.write("fmt ", 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22);
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 2, 28);
out.writeUInt16LE(2, 32);
out.writeUInt16LE(16, 34);
out.write("data", 36);
out.writeUInt32LE(dataSize, 40);
for (let i = 0; i < N; i++) out.writeInt16LE(Math.round(buf[i] * 32767), 44 + i * 2);
writeFileSync(new URL("./assets/hum.wav", import.meta.url), out);
console.log(`wrote assets/hum.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
