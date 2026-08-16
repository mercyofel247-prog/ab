// Deterministic "alert wash" sting for Shot 11.
// Neutral studio hum -> rising tension -> wash impact + metallic ring at 2.05s -> low alert pulse bed.
// Renders a 6s mono 48kHz 16-bit PCM WAV. No randomness, no network.
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 6.0;
const N = Math.round(SR * DUR);
const HIT = 2.05; // wash lands here — must match the composition timeline
const TAU = Math.PI * 2;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const softclip = (x) => Math.tanh(x);

const buf = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const t = i / SR;

  // low studio hum bed across the whole shot
  let s = 0.03 * Math.sin(TAU * 70 * t);

  // rising tension drone 0.6s -> hit
  if (t > 0.6 && t < HIT + 0.01) {
    const env = clamp((t - 0.6) / (HIT - 0.6), 0, 1);
    s += 0.13 * Math.sin(TAU * 150 * t) * env;
  }

  // sub impact at the wash
  if (t >= HIT) {
    const d = t - HIT;
    s += 0.85 * Math.sin(TAU * 55 * t) * Math.exp(-7 * d);
    // metallic ring (detuned partials, bell-like decay)
    const ring =
      Math.sin(TAU * 2093 * t) +
      0.55 * Math.sin(TAU * 3136 * t) +
      0.33 * Math.sin(TAU * 4200 * t);
    s += 0.13 * ring * Math.exp(-6 * d);
  }

  // low alert pulse bed after the hit
  if (t > 2.1 && t < 4.7) {
    const pulse = 0.5 + 0.5 * Math.sin(TAU * 3 * t);
    s += 0.07 * (Math.sin(TAU * 330 * t) + 0.6 * Math.sin(TAU * 247 * t)) * pulse;
  }

  // global attack + tail fades
  s *= clamp(t / 0.08, 0, 1);
  s *= clamp((DUR - t) / 0.7, 0, 1);

  const v = Math.round(softclip(s) * 0.95 * 32767);
  buf.writeInt16LE(clamp(v, -32768, 32767), i * 2);
}

// WAV header (PCM 16-bit mono)
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + buf.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(buf.length, 40);

writeFileSync(new URL("./sting.wav", import.meta.url), Buffer.concat([header, buf]));
console.log("wrote sting.wav", (44 + buf.length) + " bytes");
