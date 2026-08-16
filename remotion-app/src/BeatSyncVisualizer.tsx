import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  interpolateColors,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import manifest from "../public/audio/beat-manifest.json";

/**
 * BeatSyncVisualizer — a 30s audio-reactive visual driven by two sources:
 *
 *  1. Real per-frame frequency data from `visualizeAudio`, which animates
 *     the radial spectrum and background energy organically.
 *  2. The pre-computed beat manifest (kick frames, bar downbeats, section
 *     boundaries), which choreographs pulses, particle bursts, flashes and
 *     titles with sample-accurate timing against the synthesized track.
 */

export type BeatSyncProps = {
  /** Track title shown during the intro. */
  title: string;
  /** Particles emitted per kick. */
  particlesPerBeat: number;
  /** Master hue offset (degrees) applied to the whole palette. */
  hueShift: number;
};

export const beatSyncDefaultProps: BeatSyncProps = {
  title: "PULSE",
  particlesPerBeat: 14,
  hueShift: 0,
};

const AUDIO = staticFile("audio/beat-track.wav");
const { beatFrames, barFrames, sections } = manifest;

// Per-section palette [background deep, accent, hot] --------------------------
type Palette = { deep: string; accent: string; hot: string; label: string };
const PALETTES: Record<string, Palette> = {
  intro: { deep: "#050a1f", accent: "#3aa0ff", hot: "#7ce7ff", label: "INTRO" },
  main: { deep: "#0a0524", accent: "#b23aff", hot: "#ff6ad5", label: "DROP" },
  break: { deep: "#03140f", accent: "#1fd6a8", hot: "#8effc9", label: "BREAK" },
  climax: { deep: "#1a0505", accent: "#ff5a2c", hot: "#ffd166", label: "PEAK" },
};

// Deterministic hash-based pseudo-random in [0,1).
const rand = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const rotateHue = (hex: string, deg: number): string => {
  if (deg === 0) return hex;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (h + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const xx = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) [rr, gg, bb] = [c, xx, 0];
  else if (h < 120) [rr, gg, bb] = [xx, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, xx];
  else if (h < 240) [rr, gg, bb] = [0, xx, c];
  else if (h < 300) [rr, gg, bb] = [xx, 0, c];
  else [rr, gg, bb] = [c, 0, xx];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(rr)}${to(gg)}${to(bb)}`;
};

/** Most recent beat's decaying pulse (0..1) with the given half-life. */
const pulseFrom = (frame: number, marks: number[], fps: number, decay: number) => {
  let best = 0;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m <= frame) {
      const dt = (frame - m) / fps;
      const p = Math.exp(-dt / decay);
      if (p > best) best = p;
    }
  }
  return best;
};

const sectionAt = (frame: number): string => {
  let name = sections[0].section;
  for (let i = 0; i < sections.length; i++) {
    if (frame >= sections[i].frame) name = sections[i].section;
  }
  return name;
};

// --- Sub-layers -------------------------------------------------------------

const Background: React.FC<{ pal: Palette; energy: number; frame: number }> = ({
  pal,
  energy,
  frame,
}) => {
  const rot = (frame * 0.4) % 360;
  return (
    <AbsoluteFill style={{ backgroundColor: pal.deep }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 55%, ${pal.accent}44 0%, transparent ${
            42 + energy * 30
          }%)`,
          opacity: 0.5 + energy * 0.5,
        }}
      />
      <AbsoluteFill
        style={{
          transform: `rotate(${rot}deg) scale(1.4)`,
          background: `conic-gradient(from 0deg, transparent, ${pal.accent}22, transparent, ${pal.hot}22, transparent)`,
          opacity: 0.35 + energy * 0.4,
          filter: "blur(40px)",
        }}
      />
    </AbsoluteFill>
  );
};

const SpectrumRing: React.FC<{
  spectrum: number[];
  pal: Palette;
  cx: number;
  cy: number;
  radius: number;
  frame: number;
  beat: number;
}> = ({ spectrum, pal, cx, cy, radius, frame, beat }) => {
  // Mirror the spectrum so the ring is bilaterally symmetric.
  const values = [...spectrum, ...spectrum.slice().reverse()];
  const count = values.length;
  const spin = frame * 0.6;
  return (
    <g transform={`rotate(${spin} ${cx} ${cy})`}>
      {values.map((v, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const len = 18 + v * 240 + beat * 30;
        const inner = radius + 6;
        const outer = inner + len;
        const x1 = cx + Math.cos(angle) * inner;
        const y1 = cy + Math.sin(angle) * inner;
        const x2 = cx + Math.cos(angle) * outer;
        const y2 = cy + Math.sin(angle) * outer;
        const t = i / count;
        const color = interpolateColors(t, [0, 0.5, 1], [
          pal.accent,
          pal.hot,
          pal.accent,
        ]);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            opacity={0.5 + v * 0.5}
          />
        );
      })}
      {/* inner ring outline */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={pal.hot}
        strokeWidth={2}
        opacity={0.5 + beat * 0.4}
      />
    </g>
  );
};

const Core: React.FC<{
  pal: Palette;
  cx: number;
  cy: number;
  beat: number;
  bass: number;
}> = ({ pal, cx, cy, beat, bass }) => {
  const r = 70 + beat * 46 + bass * 30;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 2.4} fill={pal.hot} opacity={0.1 + beat * 0.18} />
      <circle cx={cx} cy={cy} r={r * 1.5} fill={pal.accent} opacity={0.18 + beat * 0.2} />
      <circle cx={cx} cy={cy} r={r} fill={pal.hot} opacity={0.9} />
      <circle cx={cx} cy={cy} r={r * 0.6} fill="#ffffff" opacity={0.85} />
    </g>
  );
};

const OrbitRings: React.FC<{
  pal: Palette;
  cx: number;
  cy: number;
  frame: number;
  beat: number;
}> = ({ pal, cx, cy, frame, beat }) => {
  const rings = [130, 200, 280];
  return (
    <g>
      {rings.map((base, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        const rot = frame * 0.9 * dir + i * 30;
        const r = base + beat * (14 + i * 8);
        const dash = 14 + i * 10;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={i % 2 === 0 ? pal.accent : pal.hot}
            strokeWidth={3}
            strokeDasharray={`${dash} ${dash * 1.6}`}
            opacity={0.35 + beat * 0.3}
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        );
      })}
    </g>
  );
};

const Particles: React.FC<{
  pal: Palette;
  cx: number;
  cy: number;
  frame: number;
  fps: number;
  perBeat: number;
}> = ({ pal, cx, cy, frame, fps, perBeat }) => {
  const life = 0.85; // seconds
  const nodes: React.ReactNode[] = [];
  for (let b = 0; b < beatFrames.length; b++) {
    const bf = beatFrames[b];
    const age = (frame - bf) / fps;
    if (age < 0 || age > life) continue;
    const prog = age / life;
    for (let p = 0; p < perBeat; p++) {
      const seed = b * 97.13 + p * 3.71;
      const angle = rand(seed) * Math.PI * 2;
      const speed = 220 + rand(seed + 1) * 340;
      const dist = speed * age * (1 - prog * 0.4);
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      const size = (2 + rand(seed + 2) * 4) * (1 - prog);
      nodes.push(
        <circle
          key={`${b}-${p}`}
          cx={x}
          cy={y}
          r={Math.max(0, size)}
          fill={rand(seed + 3) > 0.5 ? pal.hot : pal.accent}
          opacity={(1 - prog) * 0.9}
        />,
      );
    }
  }
  return <g>{nodes}</g>;
};

// --- Main component ---------------------------------------------------------

export const BeatSyncVisualizer: React.FC<BeatSyncProps> = ({
  title,
  particlesPerBeat,
  hueShift,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const audioData = useAudioData(AUDIO);

  const cx = width / 2;
  const cy = height / 2;

  // Choreographed pulses from the manifest.
  const beat = pulseFrom(frame, beatFrames, fps, 0.12);
  const bass = pulseFrom(frame, beatFrames, fps, 0.22);
  const downbeat = pulseFrom(frame, barFrames, fps, 0.3);

  // Section palette (hue-shifted by prop).
  const secName = sectionAt(frame);
  const base = PALETTES[secName] ?? PALETTES.intro;
  const pal: Palette = {
    deep: rotateHue(base.deep, hueShift),
    accent: rotateHue(base.accent, hueShift),
    hot: rotateHue(base.hot, hueShift),
    label: base.label,
  };

  // Real frequency spectrum (guard until audio metadata is loaded).
  let spectrum: number[] = new Array(48).fill(0);
  let energy = 0;
  if (audioData) {
    const raw = visualizeAudio({
      fps,
      frame,
      audioData,
      numberOfSamples: 128,
      smoothing: true,
    });
    // Use the lower/mid bands (upper bands are near-silent) for the ring.
    spectrum = raw.slice(0, 48).map((v) => Math.min(1, v * 3.2));
    for (let i = 0; i < spectrum.length; i++) energy += spectrum[i];
    energy = Math.min(1, energy / spectrum.length / 0.45);
  }

  // Global slow push-in over the full 30s.
  const camScale = interpolate(frame, [0, durationInFrames], [1.0, 1.12], {
    easing: Easing.inOut(Easing.sin),
    extrapolateRight: "clamp",
  });

  // Downbeat flash overlay.
  const flash = downbeat * 0.12;

  // Title intro (frames 0-120) and section label chip.
  const titleOpacity = interpolate(frame, [6, 24, 96, 118], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleScale = interpolate(frame, [6, 40], [0.8, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: pal.deep }}>
      <Audio src={AUDIO} />

      <AbsoluteFill style={{ transform: `scale(${camScale})` }}>
        <Background pal={pal} energy={energy} frame={frame} />

        <AbsoluteFill>
          <svg width={width} height={height}>
            <OrbitRings pal={pal} cx={cx} cy={cy} frame={frame} beat={beat} />
            <SpectrumRing
              spectrum={spectrum}
              pal={pal}
              cx={cx}
              cy={cy}
              radius={300}
              frame={frame}
              beat={beat}
            />
            <Particles
              pal={pal}
              cx={cx}
              cy={cy}
              frame={frame}
              fps={fps}
              perBeat={particlesPerBeat}
            />
            <Core pal={pal} cx={cx} cy={cy} beat={beat} bass={bass} />
          </svg>
        </AbsoluteFill>
      </AbsoluteFill>

      {/* Downbeat flash */}
      <AbsoluteFill
        style={{ backgroundColor: pal.hot, opacity: flash, mixBlendMode: "screen" }}
      />

      {/* Title */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: titleOpacity,
        }}
      >
        <div
          style={{
            fontFamily: "'Helvetica Neue', Arial, sans-serif",
            fontWeight: 800,
            fontSize: 180,
            letterSpacing: 24,
            color: "#ffffff",
            textShadow: `0 0 60px ${pal.hot}`,
            transform: `scale(${titleScale})`,
          }}
        >
          {title}
        </div>
      </AbsoluteFill>

      {/* Section label chip (bottom) */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 70,
        }}
      >
        <div
          style={{
            fontFamily: "'Helvetica Neue', Arial, sans-serif",
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: 14,
            color: pal.hot,
            padding: "10px 30px",
            border: `2px solid ${pal.accent}`,
            borderRadius: 999,
            opacity: 0.55 + beat * 0.4,
            boxShadow: `0 0 ${20 + beat * 40}px ${pal.accent}`,
          }}
        >
          {pal.label}
        </div>
      </AbsoluteFill>

      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,0.75) 100%)",
        }}
      />

      {/* Film grain */}
      <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: 0.06 }}>
        <svg width="100%" height="100%">
          <filter id="beatGrain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.85"
              numOctaves={2}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#beatGrain)" />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
