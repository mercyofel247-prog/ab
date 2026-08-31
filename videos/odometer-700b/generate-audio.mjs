// Deterministic WAV synth for the odometer-700b reveal.
// 6.0s, 48kHz, 16-bit mono. No dependencies.
//
// Mirrors the exact digit-motion math from index.html (expo.out roll per
// wheel, same START/LOCK_TIME/SETTLE_TIME constants) so the sound design
// locks to the visuals:
//
//   0.20-4.80s  cascading count-up: a continuous velocity-driven "whirr"
//               per wheel (loud+bright when spinning fast, fading as it
//               decelerates) plus throttled discrete ticks as each wheel
//               slows into place — ones locks 4.10s, tens 4.45s, hund 4.80s.
//               A slow tension riser builds underneath the whole climb.
//   4.80s       LOUD impact hit — the $700B lock: transient + boom +
//               a bright bell-like shimmer (paired with the light sweep).
//   5.14s       a small secondary "tink" as the digit's spring recoil settles.
//   5.50-6.00s  exit whoosh — a falling, decaying sweep that resolves to
//               silence exactly as the picture finishes fading to black.
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 6.0;
const N = Math.floor(SR * DUR);
const buf = new Float64Array(N);

// ---- Timing, mirrored from index.html ------------------------------------
const START = 0.2;
const wheels = [
  { key: "ones", final: 200, start: START, dur: 3.9, pitch: 1180, weight: 0.55 },
  { key: "tens", final: 20, start: START, dur: 4.25, pitch: 740, weight: 0.75 },
  { key: "hund", final: 7, start: START, dur: 4.6, pitch: 410, weight: 1.0 },
];
const LOCK_TIME = START + 4.6; // 4.8s
const SETTLE_TIME = LOCK_TIME + 0.34; // 5.14s
const EXIT_START = 5.5;

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
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, t) => {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
};

// ---- Same expo.out roll model as the visual wheels ------------------------
function expoOut(x) {
  x = clamp01(x);
  return 1 - Math.pow(2, -10 * x);
}
function expoOutDeriv(x) {
  return 10 * Math.LN2 * Math.pow(2, -10 * clamp01(x));
}
function wheelPos(w, t) {
  const x = clamp01((t - w.start) / w.dur);
  return w.final * expoOut(x);
}
function wheelVel(w, t) {
  if (t < w.start || t > w.start + w.dur) return 0;
  const x = (t - w.start) / w.dur;
  return (w.final / w.dur) * expoOutDeriv(x);
}

// ---- Layer 1: per-wheel velocity-driven "whirr" + throttled discrete ticks
const lpState = { ones: 0, tens: 0, hund: 0 };
const VEL_REF = { ones: 260, tens: 40, hund: 12 }; // roughly each wheel's peak velocity

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let s = 0;
  for (const w of wheels) {
    const vel = wheelVel(w, t);
    if (vel <= 0) continue;
    const intensity = clamp01(vel / VEL_REF[w.key]);
    const white = rnd() * 2;
    const cutoff = 0.015 + 0.5 * intensity;
    lpState[w.key] += cutoff * (white - lpState[w.key]);
    s += lpState[w.key] * intensity * 0.4 * w.weight;
  }
  buf[i] += s;
}

// tension riser: slow rising sub drone under the whole climb
{
  let lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    if (t >= LOCK_TIME + 0.05) continue;
    const env = 0.44 * smooth(0.5, LOCK_TIME - 0.1, t) * (1 - smooth(LOCK_TIME - 0.15, LOCK_TIME + 0.05, t) * 0.4);
    if (env <= 0) continue;
    const freq = 36 + 14 * smooth(0.8, LOCK_TIME, t);
    buf[i] += Math.sin(2 * Math.PI * freq * t) * env;
    buf[i] += Math.sin(2 * Math.PI * freq * 1.5 * t) * env * 0.3;
  }
}

// discrete throttled ticks per wheel — dense early, sparse near lock
const MIN_TICK_GAP = 0.032;
for (const w of wheels) {
  let prevFloor = 0;
  let lastTickT = -1;
  const dt = 1 / 4000;
  for (let t = w.start; t <= w.start + w.dur; t += dt) {
    const pos = wheelPos(w, t);
    const fl = Math.floor(pos);
    if (fl > prevFloor) {
      prevFloor = fl;
      if (lastTickT < 0 || t - lastTickT >= MIN_TICK_GAP) {
        lastTickT = t;
        const progressToLock = clamp01((t - w.start) / w.dur);
        const amp = (0.26 + 0.32 * progressToLock) * w.weight;
        const start = Math.floor(t * SR);
        const len = Math.floor(0.024 * SR);
        for (let k = 0; k < len && start + k < N; k++) {
          const env = Math.exp(-k / (0.007 * SR));
          const tone = Math.sin(2 * Math.PI * w.pitch * (k / SR));
          const click = rnd() * 0.6;
          buf[start + k] += (tone * 0.7 + click) * env * amp;
        }
      }
    }
  }
}

// ---- Layer 2: a premium cinematic "braam" hit at the $700B lock -----------
const hitStart = Math.floor(LOCK_TIME * SR);

// (a) pre-hit riser-snap — a fast rising sweep that arrives right at the hit,
// giving the impact a sense of momentum instead of appearing from nowhere.
{
  let lp = 0;
  const preLen = Math.floor(0.11 * SR);
  const preStart = hitStart - preLen;
  for (let k = 0; k < preLen && preStart + k >= 0; k++) {
    const tk = k / preLen; // 0..1 across the riser
    const env = tk * tk * 0.5;
    const white = rnd() * 2;
    const cutoff = 0.05 + 0.7 * tk * tk;
    lp += cutoff * (white - lp);
    const chirp = Math.sin(2 * Math.PI * (500 + 2600 * tk * tk) * (k / SR));
    buf[preStart + k] += (lp * 0.6 + chirp * 0.5) * env;
  }
}

// Build the hit "dry" (un-reverberated) so a shared reverb tail can be
// derived from it below — this is what makes it read as a real space
// rather than a flat synthesized blip.
const HIT_LEN = Math.floor(2.4 * SR);
const hitDry = new Float64Array(HIT_LEN);

// (b) tight transient: a fast noise crack + a pitch-dropping "thwack"
{
  let click = 0;
  const len = Math.floor(0.018 * SR);
  for (let k = 0; k < len; k++) {
    const env = Math.exp(-k / (0.0032 * SR));
    click += 0.55 * (rnd() * 2 - click);
    hitDry[k] += click * env * 1.3;
  }
  const thLen = Math.floor(0.02 * SR);
  for (let k = 0; k < thLen; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.007);
    const pf = 210 - 150 * (k / thLen);
    hitDry[k] += Math.sin(2 * Math.PI * pf * tk) * env * 0.9;
  }
}

// (c) sub-bass thump — the physical weight of the hit
{
  const len = Math.floor(0.65 * SR);
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.22) * (1 - Math.exp(-tk / 0.0015));
    hitDry[k] += Math.sin(2 * Math.PI * 62 * tk) * env * 1.1;
  }
}

// (d) the braam body — several closely detuned tones for a thick, cinematic
// horn-like chord instead of a single thin sine boom.
{
  const len = Math.floor(1.7 * SR);
  const root = 130;
  const detunes = [1, 1.005, 0.997, 2.003, 3.002];
  const gains = [0.85, 0.7, 0.7, 0.4, 0.22];
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.5);
    let body = 0;
    for (let p = 0; p < detunes.length; p++) {
      body += Math.sin(2 * Math.PI * root * detunes[p] * tk) * gains[p];
    }
    hitDry[k] += body * env * 0.5;
  }
}

// (e) bell-like shimmer — real inharmonic partial ratios, each with its own
// decay (higher partials die faster, as on a struck metal bell), paired
// with the light-sweep glint.
{
  const len = Math.floor(1.9 * SR);
  const partials = [
    { ratio: 1, decay: 0.7, gain: 1.0 },
    { ratio: 2.01, decay: 0.5, gain: 0.6 },
    { ratio: 2.76, decay: 0.38, gain: 0.42 },
    { ratio: 3.9, decay: 0.28, gain: 0.3 },
    { ratio: 5.4, decay: 0.18, gain: 0.2 },
  ];
  const base = 880;
  for (let k = 0; k < len; k++) {
    const tk = k / SR;
    const attack = 1 - Math.exp(-tk / 0.003);
    let shimmer = 0;
    for (const p of partials) {
      shimmer += Math.sin(2 * Math.PI * base * p.ratio * tk) * p.gain * Math.exp(-tk / p.decay);
    }
    hitDry[k] += shimmer * attack * 0.13;
  }
}

// write the dry hit into the main buffer
for (let k = 0; k < HIT_LEN && hitStart + k < N; k++) {
  buf[hitStart + k] += hitDry[k];
}

// (f) a simple decaying multi-tap reverb derived from the dry hit — this is
// what turns a synthesized blip into something that feels like it's hitting
// a real, premium space instead of a dry effect sitting on top of the video.
{
  const taps = [
    { delay: 0.045, gain: 0.34, cutoff: 0.26 },
    { delay: 0.083, gain: 0.24, cutoff: 0.21 },
    { delay: 0.131, gain: 0.17, cutoff: 0.17 },
    { delay: 0.189, gain: 0.11, cutoff: 0.13 },
    { delay: 0.257, gain: 0.07, cutoff: 0.1 },
    { delay: 0.34, gain: 0.045, cutoff: 0.08 },
  ];
  for (const tap of taps) {
    let lp = 0;
    const offset = Math.floor(tap.delay * SR);
    for (let k = 0; k < HIT_LEN && hitStart + offset + k < N; k++) {
      lp += tap.cutoff * (hitDry[k] - lp);
      buf[hitStart + offset + k] += lp * tap.gain;
    }
  }
}

// (g) small secondary "tink" as the spring recoil settles
{
  const settleStart = Math.floor(SETTLE_TIME * SR);
  const len = Math.floor(0.18 * SR);
  for (let k = 0; k < len && settleStart + k < N; k++) {
    const tk = k / SR;
    const env = Math.exp(-tk / 0.045);
    const tone = Math.sin(2 * Math.PI * 1400 * tk) + 0.5 * Math.sin(2 * Math.PI * 2000 * tk);
    buf[settleStart + k] += tone * env * 0.18;
  }
}

// ---- Layer 3: exit whoosh — falls away to silence at the fade's end -------
{
  let lp = 0;
  const exitStart = Math.floor(EXIT_START * SR);
  const len = Math.floor((DUR - EXIT_START) * SR);
  for (let k = 0; k < len && exitStart + k < N; k++) {
    const tk = k / SR;
    const local = tk / (DUR - EXIT_START); // 0..1 across the exit
    const env = (1 - local) * smooth(0, 0.06, tk);
    const white = rnd() * 2;
    const cutoff = 0.28 - 0.24 * local; // brightness falls as it recedes
    lp += Math.max(0.01, cutoff) * (white - lp);
    buf[exitStart + k] += lp * env * 0.6;
    const subPf = 70 - 40 * local;
    buf[exitStart + k] += Math.sin(2 * Math.PI * subPf * tk) * env * 0.4;
  }
}

// --- normalize + gentle soft-clip, fade the very end to true silence ---
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.95 / peak : 1;
const fadeStart = Math.floor((DUR - 0.1) * SR);
for (let i = 0; i < N; i++) {
  let v = buf[i] * norm;
  v = Math.tanh(v * 1.15);
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
writeFileSync(new URL("./assets/reveal.wav", import.meta.url), out);
console.log(`wrote assets/reveal.wav (${(dataSize / 1024).toFixed(0)} KB, ${DUR}s @ ${SR}Hz)`);
