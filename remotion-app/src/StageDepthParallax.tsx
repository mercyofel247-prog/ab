import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from "remotion";

/**
 * Configurable styling props for the StageDepthParallax composition.
 * These are surfaced as default props on the <Composition> so they can be
 * tuned live from the Remotion Studio props editor.
 */
export type StageDepthParallaxProps = {
  /** Cool stage-blue tint used for the color grade / vignette pass. */
  tintColor: string;
  /** Strength of the SVG film-grain overlay (0 = off, 1 = heavy). */
  grainIntensity: number;
  /** Multiplier applied on top of every plane's parallax scale delta. */
  scaleMultiplier: number;
};

export const stageDepthParallaxDefaultProps: StageDepthParallaxProps = {
  tintColor: "#4a6fa5",
  grainIntensity: 0.08,
  scaleMultiplier: 1,
};

// ---------------------------------------------------------------------------
// Timeline constants — all timing is expressed in frames at 24fps.
// ---------------------------------------------------------------------------
const MOTION_START = 0;
const MOTION_END = 112; // camera motion locks static from 112 → 120
const DRIFT_START = 12; // 500ms
const DRIFT_END = 108; // 4500ms

/**
 * Interpolate a scale delta from `from` → `to` across the motion window,
 * amplifying the delta (not the base) by `scaleMultiplier` so a multiplier
 * of 1 leaves the authored values untouched.
 */
const planeScale = (
  frame: number,
  from: number,
  to: number,
  multiplier: number,
  easing: (t: number) => number = Easing.inOut(Easing.quad),
): number => {
  const eased = interpolate(frame, [MOTION_START, MOTION_END], [from, to], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return from + (eased - from) * multiplier;
};

/**
 * Far plane — an abstract, out-of-focus digital screen. Blurred geometric
 * gradient meshes only; deliberately no readable UI or text.
 */
const FarPlane: React.FC<{ scale: number }> = ({ scale }) => (
  <AbsoluteFill style={{ transform: `scale(${scale})` }}>
    <AbsoluteFill
      style={{
        filter: "blur(60px)",
        background:
          "radial-gradient(45% 55% at 32% 40%, rgba(64,120,200,0.55) 0%, transparent 70%)," +
          "radial-gradient(40% 50% at 70% 55%, rgba(120,80,200,0.45) 0%, transparent 72%)," +
          "radial-gradient(60% 40% at 50% 80%, rgba(30,140,170,0.40) 0%, transparent 75%)",
      }}
    />
    <AbsoluteFill
      style={{
        filter: "blur(90px)",
        opacity: 0.6,
        background:
          "conic-gradient(from 210deg at 55% 45%, rgba(70,130,220,0.35), transparent 30%, rgba(140,70,200,0.30) 60%, transparent 85%)",
      }}
    />
  </AbsoluteFill>
);

/**
 * Mid plane — stage architecture and volumetric overhead beams. Establishes
 * the floor perspective and the angled light cones that read as depth.
 */
const MidPlane: React.FC<{ scale: number }> = ({ scale }) => (
  <AbsoluteFill style={{ transform: `scale(${scale})` }}>
    {/* Stage floor — perspective gradient anchored to the bottom edge. */}
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, transparent 55%, rgba(12,20,40,0.7) 78%, rgba(4,8,18,0.95) 100%)",
      }}
    />
    {/* Left and right stage edge falloffs. */}
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(90deg, rgba(3,6,16,0.85) 0%, transparent 22%, transparent 78%, rgba(3,6,16,0.85) 100%)",
      }}
    />
    {/* Overhead angled volumetric light cones. */}
    <div
      style={{
        position: "absolute",
        top: "-10%",
        left: "18%",
        width: "22%",
        height: "120%",
        transform: "rotate(9deg)",
        transformOrigin: "top center",
        filter: "blur(40px)",
        background:
          "linear-gradient(180deg, rgba(150,190,255,0.45) 0%, rgba(120,160,240,0.12) 45%, transparent 80%)",
        clipPath: "polygon(38% 0%, 62% 0%, 100% 100%, 0% 100%)",
      }}
    />
    <div
      style={{
        position: "absolute",
        top: "-10%",
        right: "20%",
        width: "26%",
        height: "125%",
        transform: "rotate(-11deg)",
        transformOrigin: "top center",
        filter: "blur(46px)",
        background:
          "linear-gradient(180deg, rgba(170,150,255,0.40) 0%, rgba(130,120,230,0.10) 48%, transparent 82%)",
        clipPath: "polygon(40% 0%, 60% 0%, 100% 100%, 0% 100%)",
      }}
    />
  </AbsoluteFill>
);

/**
 * Foreground plane — a high-contrast, back-lit silhouette figure standing
 * centre stage. Rendered as a filled profile so no face is ever revealed.
 */
const ForegroundPlane: React.FC<{ scale: number }> = ({ scale }) => (
  <AbsoluteFill style={{ transform: `scale(${scale})` }}>
    {/* Back-light rim glow behind the figure. */}
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: "0%",
        width: "40%",
        height: "85%",
        transform: "translateX(-50%)",
        filter: "blur(70px)",
        background:
          "radial-gradient(50% 60% at 50% 30%, rgba(160,200,255,0.5) 0%, transparent 70%)",
      }}
    />
    {/* The silhouette itself — pure black, no interior detail. Composed
        from a head, neck and torso/legs so the profile stays clean. */}
    <svg
      viewBox="0 0 400 600"
      preserveAspectRatio="xMidYMax meet"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 0,
        height: "82%",
        transform: "translateX(-50%)",
      }}
    >
      <g fill="#000000">
        {/* Head */}
        <ellipse cx="200" cy="70" rx="46" ry="52" />
        {/* Neck */}
        <rect x="182" y="110" width="36" height="34" />
        {/* Torso, shoulders and legs as a single body outline */}
        <path
          d="M200 128
             c-40 0 -74 22 -90 58
             c-9 20 -14 44 -16 70
             c-2 30 -2 62 0 96
             c1 46 4 92 8 138
             l2 42 l58 0 l4 -150 c1 -22 15 -34 32 -34
             s31 12 32 34 l4 150 l58 0 l2 -42
             c4 -46 7 -92 8 -138
             c2 -34 2 -66 0 -96
             c-2 -26 -7 -50 -16 -70
             c-16 -36 -50 -58 -90 -58 z"
        />
      </g>
    </svg>
  </AbsoluteFill>
);

/**
 * Atmosphere — volumetric haze and drifting light scatter. Drifts a couple
 * of pixels across the motion window and blooms up to 0.14 opacity.
 */
const Atmosphere: React.FC<{
  driftX: number;
  driftY: number;
  bloomOpacity: number;
}> = ({ driftX, driftY, bloomOpacity }) => (
  <AbsoluteFill style={{ opacity: bloomOpacity }}>
    <AbsoluteFill
      style={{
        transform: `translate(${driftX}px, ${driftY}px)`,
        filter: "blur(80px)",
        background:
          "radial-gradient(60% 40% at 40% 30%, rgba(180,210,255,0.9) 0%, transparent 70%)," +
          "radial-gradient(50% 45% at 68% 55%, rgba(150,180,255,0.7) 0%, transparent 72%)",
        mixBlendMode: "screen",
      }}
    />
  </AbsoluteFill>
);

/**
 * SVG feTurbulence film grain, tiled full-frame and blended in overlay so it
 * roughens the highlights without washing out the blacks.
 */
const FilmGrain: React.FC<{ intensity: number }> = ({ intensity }) => (
  <AbsoluteFill
    style={{
      mixBlendMode: "overlay",
      opacity: intensity,
      pointerEvents: "none",
    }}
  >
    <svg width="100%" height="100%">
      <filter id="stageGrain">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves={2}
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#stageGrain)" />
    </svg>
  </AbsoluteFill>
);

export const StageDepthParallax: React.FC<StageDepthParallaxProps> = ({
  tintColor,
  grainIntensity,
  scaleMultiplier,
}) => {
  const frame = useCurrentFrame();

  // Global camera push-in on the whole stack.
  const containerScale = interpolate(
    frame,
    [MOTION_START, MOTION_END],
    [1.0, 1.05],
    {
      easing: Easing.inOut(Easing.quad),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  // Per-plane parallax — larger deltas for planes further from camera.
  const fgScale = planeScale(frame, 1.0, 1.02, scaleMultiplier);
  const midScale = planeScale(frame, 1.0, 1.045, scaleMultiplier);
  const farScale = planeScale(frame, 1.0, 1.06, scaleMultiplier);

  // Atmospheric drift + screen bloom, active 12 → 108, sinusoidal ease.
  const sinEase = Easing.inOut(Easing.sin);
  const driftX = interpolate(frame, [DRIFT_START, DRIFT_END], [-8, 8], {
    easing: sinEase,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const driftY = interpolate(frame, [DRIFT_START, DRIFT_END], [6, -6], {
    easing: sinEase,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bloomOpacity = interpolate(
    frame,
    [DRIFT_START, DRIFT_END],
    [0.0, 0.14],
    {
      easing: sinEase,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill className="bg-[#0a0f1d] overflow-hidden">
      {/* 1. Global scaling wrapper */}
      <AbsoluteFill style={{ transform: `scale(${containerScale})` }}>
        <FarPlane scale={farScale} />
        <MidPlane scale={midScale} />
        <ForegroundPlane scale={fgScale} />
        <Atmosphere
          driftX={driftX}
          driftY={driftY}
          bloomOpacity={bloomOpacity}
        />
      </AbsoluteFill>

      {/* 2. Color grade & lens overlays (static, root level) */}
      <FilmGrain intensity={grainIntensity} />

      {/* Vignette (0.5 strength) + cool stage-blue tint pass. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, transparent 40%, rgba(5,10,25,0.85) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: tintColor,
          mixBlendMode: "color",
          opacity: 0.18,
        }}
      />
    </AbsoluteFill>
  );
};
