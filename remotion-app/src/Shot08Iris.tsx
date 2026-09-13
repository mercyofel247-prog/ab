import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Deterministic PRNG so dust drift and camera-shake jitter are
// frame-reproducible across re-renders, unlike Math.random().
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BG = "#0B0B0C";
const METAL = "#C9C4BA";
const OXBLOOD = "#7A160E";
const CAPTION_COLOR = "#EDE8DD";

const DUST_COUNT = 70;
const DUST_SEED = 777;
const SHAKE_SEED = 1337;

// Eye housing is wider than tall (an "eye", not a disc) on purpose: a true
// circle at 55% of frame width (1056px) would have a diameter (and, at the
// frame-34 112% overshoot, ~1183px) that cannot fit inside a 1080px-tall
// frame at any vertical position. The elliptical housing keeps the exact
// 55%-of-width spec while leaving vertical headroom for the impact punch.
const IRIS_W = 1056;
const IRIS_H = 760;
const IRIS_MAX_RX = IRIS_W / 2;
const IRIS_MAX_RY = IRIS_H / 2;
// Right-of-center, but pulled in from the right-third centroid (x=1600) so
// the housing's bounding box at the 112% impact peak still clears the
// right edge of the frame.
const IRIS_CX = 1310;
const IRIS_CY = 540;

const RING_OUTER_F = 0.66;
const HOUSING_INNER_F = 0.72;
const HOUSING_OUTER_F = 0.97;

type Dust = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  baseOpacity: number;
  phase: number;
};

const DustField: React.FC<{ width: number; height: number; frame: number }> = ({
  width,
  height,
  frame,
}) => {
  const motes = useMemo<Dust[]>(() => {
    const rand = mulberry32(DUST_SEED);
    return Array.from({ length: DUST_COUNT }, () => ({
      x: rand() * width,
      y: rand() * height,
      vx: (rand() - 0.5) * 0.35,
      vy: (rand() - 0.5) * 0.22 - 0.05,
      size: 1.2 + rand() * 2.6,
      baseOpacity: 0.14 + rand() * 0.34,
      phase: rand() * Math.PI * 2,
    }));
  }, [width, height]);

  return (
    <>
      {motes.map((m, i) => {
        const x = (((m.x + m.vx * frame) % width) + width) % width;
        const bob = Math.sin(frame * 0.05 + m.phase) * 6;
        const y = (((m.y + m.vy * frame + bob) % height) + height) % height;
        const twinkle = 0.75 + 0.25 * Math.sin(frame * 0.08 + m.phase * 2);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: m.size,
              height: m.size,
              borderRadius: "50%",
              backgroundColor: "#D9D3C4",
              opacity: m.baseOpacity * twinkle,
            }}
          />
        );
      })}
    </>
  );
};

// A closed evenodd path (outer ellipse + inner ellipse) renders as a true
// hollow annulus -- a masked ring, not a filled disc with a color on top.
function ellipseSubpath(cx: number, cy: number, rx: number, ry: number) {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

const IrisCluster: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  // Real geometric aperture radius (not a color fade): closed/dormant
  // through frame 12, stops down toward a near-pinhole by 20, then
  // reopens wide by the frame-34 impact.
  const apertureF = interpolate(
    frame,
    [0, 12, 20, 34],
    [0.32, 0.32, 0.09, 0.54],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Emissive ring brightness: dark through 12, brightens across the
  // close-down/reopen sweep, a sharp one-frame spike to its brightest
  // value at exactly 34, then settles to a steady glow by 37.
  const ringOpacity = interpolate(
    frame,
    [0, 12, 20, 33, 34, 35, 37],
    [0, 0, 0.32, 0.55, 1, 0.86, 0.75],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Faint continuous breathing pulse from frame 41 on, ramped in over
  // 37-41 so it doesn't start with a visible jump.
  const breathAmount = interpolate(frame, [37, 41], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringBreath =
    ringOpacity + breathAmount * 0.06 * Math.sin((frame - 41) * 0.15);

  const glintOpacity = interpolate(frame, [12, 14, 31, 34], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glintAngle = interpolate(frame, [12, 34], [-130, 70], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // The frame-34 impact punch: a spring launched from its peak (1) toward
  // rest (0), so the value is exactly 1 (112%) at frame 34 and rings down
  // to ~0 (100%) by frame 37, per spec's exact damping/stiffness.
  const clusterScale =
    frame < 34
      ? 1
      : 1 +
        0.12 *
          spring({
            frame: frame - 34,
            fps,
            config: { damping: 12, stiffness: 300 },
            from: 1,
            to: 0,
          });

  const rad = (glintAngle * Math.PI) / 180;
  const glintF = (RING_OUTER_F + HOUSING_OUTER_F) / 2;
  const glintX = IRIS_MAX_RX + Math.cos(rad) * IRIS_MAX_RX * glintF;
  const glintY = IRIS_MAX_RY + Math.sin(rad) * IRIS_MAX_RY * glintF;

  const outerRx = HOUSING_OUTER_F * IRIS_MAX_RX;
  const outerRy = HOUSING_OUTER_F * IRIS_MAX_RY;
  const innerBevelRx = HOUSING_INNER_F * IRIS_MAX_RX;
  const innerBevelRy = HOUSING_INNER_F * IRIS_MAX_RY;
  const ringOuterRx = RING_OUTER_F * IRIS_MAX_RX;
  const ringOuterRy = RING_OUTER_F * IRIS_MAX_RY;
  const apRx = apertureF * IRIS_MAX_RX;
  const apRy = apertureF * IRIS_MAX_RY;

  const ringPath = `${ellipseSubpath(IRIS_MAX_RX, IRIS_MAX_RY, ringOuterRx, ringOuterRy)} ${ellipseSubpath(IRIS_MAX_RX, IRIS_MAX_RY, apRx, apRy)}`;

  return (
    <div
      style={{
        position: "absolute",
        left: IRIS_CX - IRIS_MAX_RX,
        top: IRIS_CY - IRIS_MAX_RY,
        width: IRIS_W,
        height: IRIS_H,
        transform: `scale(${clusterScale})`,
        transformOrigin: "50% 50%",
      }}
    >
      <svg
        width={IRIS_W}
        height={IRIS_H}
        viewBox={`0 0 ${IRIS_W} ${IRIS_H}`}
        style={{ overflow: "visible" }}
      >
        <defs>
          <radialGradient id="metalGrad" cx="42%" cy="38%" r="75%">
            <stop offset="0%" stopColor="#EDE8DD" />
            <stop offset="18%" stopColor={METAL} />
            <stop offset="55%" stopColor="#8E897E" />
            <stop offset="100%" stopColor="#46433C" />
          </radialGradient>
        </defs>

        {/* Housing / machined bevel */}
        <ellipse
          cx={IRIS_MAX_RX}
          cy={IRIS_MAX_RY}
          rx={outerRx}
          ry={outerRy}
          fill="url(#metalGrad)"
        />
        {[0.8, 0.86, 0.92].map((f) => (
          <ellipse
            key={f}
            cx={IRIS_MAX_RX}
            cy={IRIS_MAX_RY}
            rx={f * outerRx}
            ry={f * outerRy}
            fill="none"
            stroke="#2E2C28"
            strokeOpacity={0.35}
            strokeWidth={2}
          />
        ))}
        <ellipse
          cx={IRIS_MAX_RX}
          cy={IRIS_MAX_RY}
          rx={innerBevelRx}
          ry={innerBevelRy}
          fill="#1C1B19"
        />

        {/* Dark ring bed -- always present, non-red, so pre-frame-12 the
            iris reads as dormant metal rather than an unlit red ring. */}
        <ellipse
          cx={IRIS_MAX_RX}
          cy={IRIS_MAX_RY}
          rx={ringOuterRx}
          ry={ringOuterRy}
          fill="#141311"
        />

        {/* Emissive oxblood ring: a genuine hollow annulus via evenodd */}
        <path
          d={ringPath}
          fillRule="evenodd"
          fill={OXBLOOD}
          opacity={ringBreath}
        />

        {/* True dark aperture hole, always on top so the center reads
            visibly darker than the ring at every frame */}
        <ellipse cx={IRIS_MAX_RX} cy={IRIS_MAX_RY} rx={apRx} ry={apRy} fill="#050506" />

        {/* Specular glint sweeping the metal bevel once */}
        <ellipse
          cx={glintX}
          cy={glintY}
          rx={14}
          ry={7}
          fill="#FFFDF6"
          opacity={glintOpacity * 0.85}
        />
      </svg>
    </div>
  );
};

const DIE_REST_TOP = 795;
const DIE_DROP_HEIGHT = 380;

const Die: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  // Pre-rolled spring: at video frame 0 the internal clock is already at
  // frame 3, so the die is mid-fall (not a static sprite) and settles,
  // with a slight overshoot, by frame 12. The same spring value drives
  // both the vertical bounce-in and the tumble rotation, so the landing
  // and the rotational stop land on the same beat.
  const tumble = spring({
    frame: frame + 3,
    fps,
    config: { damping: 14, stiffness: 200 },
  });
  const rotateZ = interpolate(tumble, [0, 1], [-380, 8]);
  const rotateX = interpolate(tumble, [0, 1], [42, 0]);

  // Falls in from above; the spring's own overshoot carries it slightly
  // past rest (a little impact give) before it settles.
  const dieTop = DIE_REST_TOP - DIE_DROP_HEIGHT * (1 - tumble);
  const heightAboveRest = Math.max(0, DIE_REST_TOP - dieTop);
  const shadowScale = interpolate(heightAboveRest, [0, DIE_DROP_HEIGHT], [1, 0.45], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const shadowOpacity = interpolate(heightAboveRest, [0, DIE_DROP_HEIGHT], [0.5, 0.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const dim = interpolate(frame, [34, 37], [1, 0.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 230 - 45 * shadowScale,
          top: DIE_REST_TOP + 136,
          width: 90 * shadowScale,
          height: 22 * shadowScale,
          borderRadius: "50%",
          background: "#000000",
          opacity: shadowOpacity * dim,
          filter: "blur(3px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 165,
          top: dieTop,
          width: 130,
          height: 130,
          perspective: 500,
          opacity: dim,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 16,
            background:
              "linear-gradient(135deg, #48484D 0%, #3A3A3E 45%, #2A2A2D 100%)",
            border: "2px solid #222224",
            boxShadow: "0 18px 30px rgba(0,0,0,0.55)",
            transform: `rotateX(${rotateX}deg) rotateZ(${rotateZ}deg)`,
            position: "relative",
          }}
        >
        {[
          [30, 30],
          [100, 30],
          [30, 100],
          [100, 100],
          [65, 65],
        ].map(([x, y], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - 9,
              top: y - 9,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#1C1C1E",
              boxShadow: "inset 0 2px 2px rgba(0,0,0,0.6)",
            }}
          />
        ))}
        </div>
      </div>
    </>
  );
};

const Caption: React.FC<{ frame: number; height: number }> = ({
  frame,
  height,
}) => {
  const opacity = interpolate(frame, [37, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: IRIS_CX,
        top: height - 125,
        transform: "translateX(-50%)",
        opacity,
        color: CAPTION_COLOR,
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: 40,
        letterSpacing: 4,
        fontWeight: 600,
        whiteSpace: "nowrap",
        textShadow: "0 2px 10px rgba(0,0,0,0.6)",
      }}
    >
      THEY GUESS. IT DOESN'T.
    </div>
  );
};

export const Shot08Iris: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const shakeJitter = useMemo(() => {
    const rand = mulberry32(SHAKE_SEED);
    return Array.from({ length: 200 }, () => ({
      dx: rand() * 2 - 1,
      dy: rand() * 2 - 1,
    }));
  }, []);

  // Camera shake: 0 outside the impact window, a hard onset exactly at 34,
  // damping out by 37.
  const shakeEnvelope = interpolate(frame, [33, 34, 37], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const jitter = shakeJitter[frame] ?? { dx: 0, dy: 0 };
  const shakeX = jitter.dx * 6 * shakeEnvelope;
  const shakeY = jitter.dy * 6 * shakeEnvelope;

  // Continuous ambient scale across the whole 41-69 hold: 1.00 -> 1.03 ->
  // 1.00, moving throughout (not just at the start of the range).
  const ambientProgress = interpolate(frame, [41, 69], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sceneScale = 1 + 0.03 * Math.sin(ambientProgress * Math.PI);

  return (
    <AbsoluteFill style={{ backgroundColor: BG, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX}px, ${shakeY}px) scale(${sceneScale})`,
          transformOrigin: "50% 50%",
        }}
      >
        <DustField width={width} height={height} frame={frame} />
        <IrisCluster frame={frame} fps={fps} />
        <Die frame={frame} fps={fps} />
        <Caption frame={frame} height={height} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
