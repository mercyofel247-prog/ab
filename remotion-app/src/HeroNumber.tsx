import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * HeroNumber — a parametric, machined brushed-metal "hero value".
 *
 * The number animates from `startValue` to `endValue` (a count-up climb or a
 * count-down collapse depending on direction), rendered as a lit, extruded
 * bone-metal numeral on near-black (Mode B: dimensional lit editorial). Reuse
 * it across shots by changing props — this is the parametric unit Remotion is for.
 */
export type HeroNumberProps = {
  startValue: number;
  endValue: number;
  /** Emissive under-glow color (oxblood, etc). `null` = dead: no glow at all. */
  accentHex: string | null;
  /** Named easing for the value move, e.g. "power4.in" (accelerating collapse). */
  easing: string;
  /** Snap a single hairline fracture across the landed value near the end. */
  fracture: boolean;
};

const EASINGS: Record<string, (t: number) => number> = {
  "power4.in": Easing.in(Easing.poly(4)),
  "power4.out": Easing.out(Easing.poly(4)),
  "power3.out": Easing.out(Easing.poly(3)),
  "power2.out": Easing.out(Easing.poly(2)),
  "expo.out": Easing.out(Easing.exp),
  linear: Easing.linear,
};

const easingFor = (name: string) => EASINGS[name] ?? Easing.inOut(Easing.ease);

const money = (v: number) => "$" + Math.round(v).toLocaleString("en-US");

const FONT = '"Helvetica Neue", Arial, Helvetica, sans-serif';

// One shared glyph style; face + extrusion layers all inherit it.
const glyphBase: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  fontFamily: FONT,
  fontSize: 180,
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: "-0.03em",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const DEPTH = 24;
const DX = 1.15;
const DY = 1.25;

export const HeroNumber: React.FC<HeroNumberProps> = ({
  startValue,
  endValue,
  accentHex,
  easing,
  fracture,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ease = easingFor(easing);
  const s = (sec: number) => sec * fps;

  // --- the value move: start -> end over 0.5s, easing matched to meaning ---
  const landFrame = s(0.5);
  const value = interpolate(frame, [0, landFrame], [startValue, endValue], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const text = money(value);

  // --- inverted sub-boom: a hollow thud on land (transform-only scale dip) ---
  const thud = interpolate(frame, [s(0.46), s(0.52), s(0.66)], [1, 0.972, 1], {
    easing: Easing.out(Easing.ease),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- optional oxblood ember that extinguishes to black (expo.out) ---
  const emberOpacity = interpolate(frame, [s(0.4), s(0.6)], [1, 0], {
    easing: Easing.out(Easing.exp),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- optional hairline fracture: opacity pop + scaleX settle, then dead stop ---
  const fractureOpacity = interpolate(frame, [s(0.55), s(0.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fractureScaleX = interpolate(frame, [s(0.55), s(0.625)], [0.94, 1], {
    easing: Easing.out(Easing.poly(3)),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // extrusion side-walls (deepest first), then the lit bone face on top
  const sideLayers = Array.from({ length: DEPTH }, (_, idx) => {
    const i = DEPTH - idx; // i: DEPTH (deepest) .. 1 (just under face)
    const lum = i <= 2 ? 0.34 : 0.22 - 0.16 * (1 - i / DEPTH);
    const c = Math.round(255 * lum);
    return (
      <div
        key={i}
        style={{
          ...glyphBase,
          zIndex: 10 + (DEPTH - i),
          color: `rgb(${c},${c},${c + 4})`,
          transform: `translate(-50%, -50%) translate(${(i * DX).toFixed(2)}px, ${(i * DY).toFixed(2)}px)`,
        }}
      >
        {text}
      </div>
    );
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "relative", width: 1728, height: 420 }}>
        {/* dying oxblood ember (emissive edge only) — omitted entirely when dead */}
        {accentHex && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "54%",
              width: 720,
              height: 260,
              transform: "translate(-50%, -50%)",
              opacity: emberOpacity,
              background: `radial-gradient(50% 50% at 50% 50%, ${accentHex}99 0%, ${accentHex}3b 40%, ${accentHex}00 70%)`,
              zIndex: 1,
            }}
          />
        )}

        {/* soft contact shadow grounding the machined numeral */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "78%",
            width: 560,
            height: 84,
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 72%)",
            filter: "blur(6px)",
            zIndex: 2,
          }}
        />

        {/* the extruded number (side-walls + bone face), scaled by the landing thud */}
        <div style={{ position: "absolute", inset: 0, transform: `scale(${thud})`, zIndex: 5 }}>
          {sideLayers}
          <div
            style={{
              ...glyphBase,
              zIndex: 60,
              transform: "translate(-50%, -50%)",
              color: "transparent",
              WebkitTextFillColor: "transparent",
              backgroundImage:
                "linear-gradient(174deg, #fffdf8 0%, #efeadf 24%, #ded9cd 48%, #f3eee3 62%, #d7d2c6 82%, #e7e2d6 100%), repeating-linear-gradient(3deg, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0) 2px, rgba(30,28,24,0.09) 3px, rgba(255,255,255,0) 5px)",
              backgroundBlendMode: "soft-light",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              textShadow: "-2px -2px 0 rgba(255,255,255,0.22)",
            }}
          >
            {text}
          </div>
        </div>

        {/* single hairline fracture across the landed value */}
        {fracture && (
          <div
            style={{
              position: "absolute",
              left: "52%",
              top: "50%",
              width: 300,
              height: 2,
              transform: `translate(-50%, -50%) rotate(-24deg) scaleX(${fractureScaleX})`,
              opacity: fractureOpacity,
              background:
                "linear-gradient(90deg, rgba(11,11,12,0) 0%, rgba(11,11,12,0.9) 12%, rgba(240,234,223,0.9) 50%, rgba(11,11,12,0.9) 88%, rgba(11,11,12,0) 100%)",
              zIndex: 70,
            }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};
