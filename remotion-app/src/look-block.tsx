import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

/**
 * Shared look-block for the valuation-beat series.
 *
 * Every beat (MetalNumeral and its siblings) pulls its palette, format and
 * film grain from here so the beats cut together as one graded sequence:
 * near-black ground, warm-bone type, oxblood as the only emissive colour.
 */
export const PALETTE = {
  /** Oxblood — reserved for emissive rim / glow. The only colour light. */
  oxblood: "#7A160E",
  /** Near-black ground. */
  ground: "#0B0B0C",
  /** Warm-bone — all type and the metal numeral face. */
  bone: "#EDE8DD",
} as const;

/** Format contract for the series: strict 16:9, 1080p, 30fps, 3s dwell. */
export const LOOK = {
  fps: 30,
  width: 1920,
  height: 1080,
  /** Dwell of a single beat: 3s @ 30fps. */
  dwellInFrames: 90,
  /** Film grain strength — 6%. */
  grainOpacity: 0.06,
} as const;

/**
 * 6% film grain, matching the shared look-block.
 *
 * Deterministic + seek-safe: the turbulence `seed` is driven straight from
 * the frame number, so every render (and every scrub) reproduces the same
 * grain field. Desaturated to neutral so it textures the image without
 * tinting the graded palette.
 */
export const FilmGrain: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: LOOK.grainOpacity,
        mixBlendMode: "overlay",
      }}
    >
      <svg width="100%" height="100%">
        <filter id="film-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.72"
            numOctaves={3}
            seed={frame}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#film-grain)" />
      </svg>
    </AbsoluteFill>
  );
};
