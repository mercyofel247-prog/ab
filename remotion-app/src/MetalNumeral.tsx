import {
  AbsoluteFill,
  Composition,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Route B — the reusable valuation-beat hero.
 *
 * <MetalNumeral value="$4.5B" label="PAPER NET WORTH" /> draws a machined,
 * brushed dark-metal numeral on near-black — a dimensional lit editorial
 * element, NOT flat vector / paper / photoreal. The value and label are pure
 * props so the same component is dropped onto every valuation beat.
 *
 * Track-2 oxblood palette only:
 *   near-black ground   #0B0B0C .. #141416
 *   warm-bone highlight #EDE8DD  (specular peak + label)
 *   oxblood-red         #7A160E  (emissive rim glow ONLY — never a flat fill)
 *   graphite            #3A3A3E  (cold secondary sheen)
 *
 * No grain / vignette / chromatic aberration is baked in — the shared master
 * grade LUT is applied later in DaVinci. Silent by design.
 */

export type MetalNumeralProps = {
  value: string;
  label: string;
};

// --- palette ------------------------------------------------------------------
const GROUND_0 = "#0B0B0C";
const GROUND_1 = "#141416";
const BONE = "#EDE8DD";
const OXBLOOD_RGB = "122,22,14"; // #7A160E — emissive rim glow only
const GRAPHITE = "#3A3A3E";

// Brushed dark-metal face: cool desaturated steps from graphite to near-black
// with a single bone specular band near the top (top-lit studio key).
const METAL_FACE =
  "linear-gradient(177deg," +
  "#8f9098 0%," +
  BONE +
  " 9%," +
  "#5b5c63 21%," +
  GRAPHITE +
  " 38%," +
  GROUND_1 +
  " 52%," +
  "#26262b 63%," +
  "#7c7d85 80%," +
  "#17171a 100%)";

// Faint brushed striations, clipped to the glyphs.
const BRUSHED =
  "repeating-linear-gradient(97deg," +
  "rgba(237,232,221,0.00) 0px," +
  "rgba(237,232,221,0.06) 1px," +
  "rgba(237,232,221,0.00) 2px," +
  "rgba(0,0,0,0.05) 3px," +
  "rgba(237,232,221,0.00) 5px)";

// Extruded metal thickness — stacked dark offsets down-right behind the face.
const extrusion = (depth: number): string => {
  const layers: string[] = [];
  for (let i = 1; i <= depth; i += 1) {
    const t = i / depth;
    const g = Math.round(20 - 12 * t); // graphite fading into black with depth
    layers.push(
      `${(i * 0.5).toFixed(2)}px ${(i * 0.9).toFixed(2)}px 0 rgb(${g},${g},${g + 2})`,
    );
  }
  // soft contact shadow cast onto the implied surface
  layers.push("0 44px 60px rgba(0,0,0,0.65)");
  return layers.join(",");
};

export const MetalNumeral: React.FC<MetalNumeralProps> = ({ value, label }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Camera drifts laterally into rest — heavily overdamped, no overshoot.
  const cameraX = spring({
    frame,
    fps,
    from: -64,
    to: 0,
    config: { damping: 200 },
  });

  // Depth planes read the same camera at different parallax rates.
  const heroX = cameraX * 1.0;
  const midX = cameraX * 0.5;
  const bgX = cameraX * 0.2;

  // Landing settle for the [LAND:billion] beat — driven off the same spring.
  const settle = spring({ frame, fps, from: 1, to: 0, config: { damping: 200 } });
  const heroScale = 1 + settle * 0.04;

  // Oxblood rim glow: blooms in and fades out — the sole accent pulse.
  const rimGlow = interpolate(frame, [0, 20, 50], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Label rises in just after the numeral seats.
  const labelIn = interpolate(frame, [14, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const rimFilter =
    `drop-shadow(0 0 6px rgba(${OXBLOOD_RGB},${(0.85 * rimGlow).toFixed(3)})) ` +
    `drop-shadow(0 0 22px rgba(${OXBLOOD_RGB},${(0.7 * rimGlow).toFixed(3)})) ` +
    `drop-shadow(0 0 60px rgba(${OXBLOOD_RGB},${(0.45 * rimGlow).toFixed(3)}))`;

  return (
    <AbsoluteFill style={{ backgroundColor: GROUND_0 }}>
      {/* Plane 0 (far): single studio key light — soft graphite bloom, shallow
          DoF softness. Parallax slowest. */}
      <AbsoluteFill style={{ transform: `translateX(${bgX}px)` }}>
        <AbsoluteFill
          style={{
            background: `radial-gradient(46% 42% at 50% 44%, ${GRAPHITE} 0%, rgba(58,58,62,0.35) 32%, ${GROUND_0} 72%)`,
            filter: "blur(18px)",
            opacity: 0.9,
          }}
        />
        <AbsoluteFill
          style={{
            background: `radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0) 55%, ${GROUND_0} 100%)`,
          }}
        />
      </AbsoluteFill>

      {/* Plane 1 (mid): soft contact shadow seating the numeral on a surface. */}
      <AbsoluteFill
        style={{
          transform: `translateX(${midX}px)`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: height * 0.66,
            width: width * 0.42,
            height: height * 0.09,
            background:
              "radial-gradient(closest-side, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 72%)",
            filter: "blur(10px)",
          }}
        />
      </AbsoluteFill>

      {/* Plane 2 (hero): the machined numeral + label. Parallax fastest. */}
      <AbsoluteFill
        style={{
          transform: `translateX(${heroX}px)`,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div style={{ filter: rimFilter }}>
          <div
            style={{
              position: "relative",
              transform: `scale(${heroScale})`,
              transformOrigin: "50% 55%",
              fontFamily: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
              fontWeight: 900,
              fontSize: Math.round(height * 0.3),
              letterSpacing: "-0.02em",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {/* extruded metal body */}
            <span
              style={{
                color: GROUND_1,
                textShadow: extrusion(14),
              }}
            >
              {value}
            </span>
            {/* brushed-metal front face, clipped to the glyphs */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                backgroundImage: `${BRUSHED}, ${METAL_FACE}`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                WebkitTextStroke: `1px rgba(11,11,12,0.55)`,
              }}
            >
              {value}
            </span>
          </div>
        </div>

        <div
          style={{
            marginTop: height * 0.055,
            opacity: labelIn,
            transform: `translateY(${(1 - labelIn) * 14}px)`,
            fontFamily: '"Helvetica Neue", Arial, sans-serif',
            fontWeight: 600,
            fontSize: Math.round(height * 0.026),
            letterSpacing: "0.5em",
            textTransform: "uppercase",
            color: BONE,
            paddingLeft: "0.5em",
          }}
        >
          {label}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const DEFAULT_PROPS: MetalNumeralProps = {
  value: "$4.5B",
  label: "PAPER NET WORTH",
};

export const MetalNumeralComposition: React.FC = () => {
  return (
    <Composition
      id="MetalNumeral"
      component={MetalNumeral}
      durationInFrames={90}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={DEFAULT_PROPS}
    />
  );
};
