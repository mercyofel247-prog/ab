import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FilmGrain, PALETTE } from "./look-block";

export type MetalNumeralProps = {
  /** The valuation to engrave, e.g. "$4.5B". */
  value: string;
  /** The kicker beneath it, e.g. "PAPER NET WORTH". */
  label: string;
};

/**
 * MetalNumeral — one valuation beat.
 *
 * A single warm-bone metal figure eased into frame by a heavily-damped
 * camera glide, with an oxblood rim that flares on the reveal and cools to
 * bare metal for the rest of the dwell. Parametric: swap `value` / `label`
 * to reuse it for every beat in the series.
 */
export const MetalNumeral: React.FC<MetalNumeralProps> = ({ value, label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Camera settle. damping:200 is heavily overdamped — no overshoot, a long
  // slow glide that eases the numeral to rest.
  const cameraSpring = spring({
    frame,
    fps,
    config: { damping: 200 },
  });
  const cameraX = interpolate(cameraSpring, [0, 1], [-48, 0]);

  // Oxblood rim glow: dark → full by frame 20, back to dark by frame 50.
  // Leaves the numeral as cold metal for the remainder of the dwell.
  const rimGlow = interpolate(frame, [0, 20, 50], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.ground }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          transform: `translateX(${cameraX}px)`,
        }}
      >
        <div style={{ position: "relative", textAlign: "center" }}>
          {/* Oxblood emissive rim — the only colour light in the frame. */}
          <div
            aria-hidden
            style={{
              ...numeralBase,
              position: "absolute",
              inset: 0,
              opacity: rimGlow,
              color: "transparent",
              WebkitTextFillColor: "transparent",
              WebkitTextStrokeWidth: 2,
              WebkitTextStrokeColor: PALETTE.oxblood,
              textShadow: [
                `0 0 18px ${PALETTE.oxblood}`,
                `0 0 44px ${PALETTE.oxblood}`,
                `0 0 84px ${PALETTE.oxblood}`,
              ].join(", "),
            }}
          >
            {value}
          </div>

          {/* Warm-bone metal numeral — reflective face, no emission. */}
          <div style={numeralMetal}>{value}</div>

          <div style={labelStyle}>{label}</div>
        </div>
      </AbsoluteFill>

      <FilmGrain />
    </AbsoluteFill>
  );
};

const numeralBase: React.CSSProperties = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: 340,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: "-0.02em",
  margin: 0,
  whiteSpace: "nowrap",
};

const numeralMetal: React.CSSProperties = {
  ...numeralBase,
  position: "relative",
  color: PALETTE.bone,
  // Brushed warm-bone metal: bright top edge, a darker waistline, a lifted
  // lower bevel — reads as a polished plate under a single overhead key.
  backgroundImage: `linear-gradient(
    180deg,
    #FFFDF7 0%,
    ${PALETTE.bone} 40%,
    #B4AD9F 54%,
    ${PALETTE.bone} 70%,
    #CFC8BA 100%
  )`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

const labelStyle: React.CSSProperties = {
  marginTop: 40,
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
  fontSize: 30,
  fontWeight: 600,
  letterSpacing: "0.44em",
  // Balance the trailing tracking so the kicker stays optically centred.
  textIndent: "0.44em",
  color: PALETTE.bone,
  opacity: 0.8,
};
