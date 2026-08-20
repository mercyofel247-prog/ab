import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { HeroNumber } from "./HeroNumber";

// Deterministic PRNG (no Math.random / Date.now) for the static cold-dust field.
const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Mote = { left: string; top: string; scale: number; opacity: number };

const seedDust = (count: number, seed: number, sMin: number, sMax: number): Mote[] => {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    left: (4 + rand() * 92).toFixed(3) + "%",
    top: (5 + rand() * 90).toFixed(3) + "%",
    scale: sMin + rand() * (sMax - sMin),
    opacity: 0.1 + rand() * 0.4,
  }));
};

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch' seed='7'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

const DustLayer: React.FC<{ motes: Mote[]; blur: number; opacity: number }> = ({
  motes,
  blur,
  opacity,
}) => (
  <AbsoluteFill style={{ filter: `blur(${blur}px)`, opacity }}>
    {motes.map((m, i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          left: m.left,
          top: m.top,
          width: 2,
          height: 2,
          borderRadius: "50%",
          background: "#b3b8c0",
          transform: `scale(${m.scale.toFixed(3)})`,
          opacity: m.opacity.toFixed(3),
        }}
      />
    ))}
  </AbsoluteFill>
);

/**
 * Theranos · Ch1 · 06 — the "$0" collapse.
 * Reuses <HeroNumber> with the shot's parameters: a prior $4.5B plummets to $0
 * (power4.in), no oxblood accent (dead), a hairline fracture on land.
 * Silent — VO/music + master LUT added in Resolve.
 */
export const Ch1_06: React.FC = () => {
  const far = useMemo(() => seedDust(55, 0x9a13, 1.2, 3.2), []);
  const near = useMemo(() => seedDust(70, 0x51ed5, 0.6, 1.6), []);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0c" }}>
      {/* ground: near-black studio sweep */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(74% 76% at 50% 46%, #141416 0%, #0b0b0c 60%, #040404 100%)",
        }}
      />

      {/* z1: cold dust, two planes (shallow DoF — hero stays crisp) */}
      <DustLayer motes={far} blur={3} opacity={0.45} />
      <DustLayer motes={near} blur={1.1} opacity={0.6} />

      {/* z2: the machined hero */}
      <HeroNumber
        startValue={4500000000}
        endValue={0}
        accentHex={null}
        easing="power4.in"
        fracture
      />

      {/* z3: vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(70% 62% at 50% 47%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.74) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* grade: ~8% grain, no bloom (static) */}
      <AbsoluteFill
        style={{
          backgroundImage: GRAIN,
          backgroundSize: "320px 320px",
          opacity: 0.075,
          mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
