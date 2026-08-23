import {
  linearTiming,
  springTiming,
  TransitionPresentation,
  TransitionPresentationComponentProps,
  TransitionSeries,
} from "@remotion/transitions";
import {
  AbsoluteFill,
  Composition,
  Easing,
  interpolate,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/* ------------------------------------------------------------------ *
 *  MERGE — 5 clips stitched with S-tier, MagnatesMedia-style          *
 *  transitions (zoom-blur punch, RGB glitch, whip-pan swish, light    *
 *  bloom) under a cinematic motion-graphics grade.                    *
 * ------------------------------------------------------------------ */

const FPS = 24;
const WIDTH = 1920;
const HEIGHT = 1080;
const ACCENT = "#e8b64c"; // warm gold accent

// Deterministic pseudo-random so glitch jitter renders identically every
// pass (no Math.random, which would flicker between blur samples).
const rand = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/* ============================ CLIP ================================== */
// A single source clip. A gentle 1.05 -> 1.0 settle on every cut adds
// energy and hides the upscale on the 720p opening shot.
const Clip: React.FC<{ src: string; dur: number }> = ({ src, dur }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, dur], [1.05, 1.0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <OffthreadVideo
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

/* ===================== TRANSITION: ZOOM BLUR ======================= */
// Whip zoom-punch: the outgoing shot rushes toward camera and blurs out
// while the incoming shot slams back from oversize into place.
const ZoomBlur: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children,
  presentationDirection,
  presentationProgress,
}) => {
  const p = presentationProgress;
  const e = easeInOut(p);
  const exiting = presentationDirection === "exiting";
  const scale = exiting
    ? interpolate(e, [0, 1], [1, 1.9])
    : interpolate(e, [0, 1], [2.3, 1]);
  const blur = exiting
    ? interpolate(p, [0, 1], [0, 30])
    : interpolate(p, [0, 1], [36, 0]);
  const opacity = exiting
    ? interpolate(p, [0.45, 1], [1, 0], { extrapolateLeft: "clamp" })
    : interpolate(p, [0, 0.55], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill
        style={{ transform: `scale(${scale})`, filter: `blur(${blur}px)` }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
const zoomBlur = (): TransitionPresentation<Record<string, unknown>> => ({
  component: ZoomBlur,
  props: {},
});

/* ===================== TRANSITION: RGB GLITCH ====================== */
// Digital tear: horizontal jitter, chromatic-aberration channel split and
// a scanline flicker rip the outgoing frame apart into the next.
const Glitch: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children,
  presentationDirection,
  presentationProgress,
}) => {
  const p = presentationProgress;
  const exiting = presentationDirection === "exiting";
  // Bell-shaped intensity — calm at the ends, violent in the middle.
  const bell = Math.sin(p * Math.PI);
  const step = Math.floor(p * 24);
  const jitterX = (rand(step) * 2 - 1) * 26 * bell;
  const jitterY = (rand(step + 7) * 2 - 1) * 10 * bell;
  const split = 12 * bell;
  const sliceTop = rand(step + 3) * 100;
  const sliceH = 6 + rand(step + 11) * 22;
  const flicker = 0.85 + rand(step + 5) * 0.15;

  const opacity = exiting
    ? interpolate(p, [0.5, 0.7], [1, 0], { extrapolateLeft: "clamp" })
    : interpolate(p, [0.3, 0.5], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: opacity * flicker }}>
      <AbsoluteFill
        style={{
          transform: `translate(${jitterX}px, ${jitterY}px)`,
          filter: `drop-shadow(${split}px 0 rgba(255,0,64,0.6)) drop-shadow(${-split}px 0 rgba(0,255,255,0.6))`,
        }}
      >
        {children}
      </AbsoluteFill>
      {/* torn slice offset the opposite way for a datamosh feel */}
      <AbsoluteFill
        style={{
          clipPath: `polygon(0 ${sliceTop}%, 100% ${sliceTop}%, 100% ${sliceTop + sliceH}%, 0 ${sliceTop + sliceH}%)`,
          transform: `translateX(${-jitterX * 1.6}px)`,
          opacity: bell,
          mixBlendMode: "screen",
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
const glitch = (): TransitionPresentation<Record<string, unknown>> => ({
  component: Glitch,
  props: {},
});

/* ===================== TRANSITION: WHIP PAN ======================== */
// Motion-blurred swish pan with a light-streak wiping across the seam.
const WhipPan: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children,
  presentationDirection,
  presentationProgress,
}) => {
  const p = presentationProgress;
  const e = easeInOut(p);
  const exiting = presentationDirection === "exiting";
  const bell = Math.sin(p * Math.PI);
  const x = exiting
    ? interpolate(e, [0, 1], [0, -60])
    : interpolate(e, [0, 1], [60, 0]);
  const blur = bell * 26;
  const opacity = exiting
    ? interpolate(p, [0.55, 0.85], [1, 0], { extrapolateLeft: "clamp" })
    : interpolate(p, [0.15, 0.45], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${x}%)`,
        filter: `blur(${blur}px)`,
      }}
    >
      {children}
      {!exiting && (
        <AbsoluteFill
          style={{
            transform: `translateX(${interpolate(p, [0, 1], [-140, 140])}%)`,
            background:
              "linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.85) 50%, transparent 58%)",
            opacity: bell,
            mixBlendMode: "screen",
          }}
        />
      )}
    </AbsoluteFill>
  );
};
const whipPan = (): TransitionPresentation<Record<string, unknown>> => ({
  component: WhipPan,
  props: {},
});

/* ===================== TRANSITION: LIGHT BLOOM ===================== */
// Bright bloom flash — the outgoing shot blows out to white and the next
// emerges from the glare with a slight punch.
const Bloom: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children,
  presentationDirection,
  presentationProgress,
}) => {
  const p = presentationProgress;
  const exiting = presentationDirection === "exiting";
  const bell = Math.sin(p * Math.PI);
  const brightness = exiting
    ? interpolate(p, [0, 1], [1, 4])
    : interpolate(p, [0, 1], [4, 1]);
  const scale = exiting
    ? interpolate(p, [0, 1], [1, 1.12])
    : interpolate(p, [0, 1], [1.12, 1]);
  const opacity = exiting
    ? interpolate(p, [0.5, 0.75], [1, 0], { extrapolateLeft: "clamp" })
    : interpolate(p, [0.25, 0.5], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          filter: `brightness(${brightness})`,
        }}
      >
        {children}
      </AbsoluteFill>
      {!exiting && (
        <AbsoluteFill
          style={{ backgroundColor: "white", opacity: bell * 0.9 }}
        />
      )}
    </AbsoluteFill>
  );
};
const bloom = (): TransitionPresentation<Record<string, unknown>> => ({
  component: Bloom,
  props: {},
});

/* ======================= MOTION-GRAPHICS GRADE ===================== */

// Animated film grain via per-frame feTurbulence seed.
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: 0.08 }}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={frame}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
};

// Cinematic vignette + subtle filmic contrast.
const Grade: React.FC = () => (
  <>
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
      }}
    />
    <AbsoluteFill
      style={{
        mixBlendMode: "soft-light",
        opacity: 0.25,
        background:
          "linear-gradient(180deg, rgba(232,182,76,0.12) 0%, rgba(0,0,0,0.25) 100%)",
      }}
    />
  </>
);

// Letterbox bars that snap in at the top and retract at the tail.
const Letterbox: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const barH = interpolate(
    frame,
    [0, 16, durationInFrames - 16, durationInFrames],
    [0, HEIGHT * 0.08, HEIGHT * 0.08, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut },
  );
  return (
    <>
      <div
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: barH, background: "black" }}
      />
      <div
        style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: barH, background: "black" }}
      />
    </>
  );
};

// HUD corner brackets — thin gold framing that fades in and breathes.
const HudFrame: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const op = interpolate(
    frame,
    [10, 30, durationInFrames - 24, durationInFrames - 4],
    [0, 0.55, 0.55, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const m = 70;
  const len = 46;
  const t = 2;
  const corner = (
    v: "top" | "bottom",
    h: "left" | "right",
  ): React.CSSProperties => ({
    position: "absolute",
    [v]: m,
    [h]: m,
    width: len,
    height: len,
    [`border${v === "top" ? "Top" : "Bottom"}`]: `${t}px solid ${ACCENT}`,
    [`border${h === "left" ? "Left" : "Right"}`]: `${t}px solid ${ACCENT}`,
  });
  return (
    <AbsoluteFill style={{ opacity: op }}>
      <div style={corner("top", "left")} />
      <div style={corner("top", "right")} />
      <div style={corner("bottom", "left")} />
      <div style={corner("bottom", "right")} />
    </AbsoluteFill>
  );
};

// Slim progress line along the very bottom.
const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const w = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        height: 4,
        width: `${w}%`,
        background: ACCENT,
        boxShadow: `0 0 12px ${ACCENT}`,
      }}
    />
  );
};

/* ========================= THE SEQUENCE ============================ */

// Clip source durations (frames @24fps).
const D = { c1: 96, c2: 144, c3: 96, c5: 96, c8: 96 };
// Transition overlap durations.
const T = { zoom: 16, glitch: 12, whip: 16, bloom: 14 };

export const TOTAL_FRAMES =
  D.c1 +
  D.c2 +
  D.c3 +
  D.c5 +
  D.c8 -
  (T.zoom + T.glitch + T.whip + T.bloom);

const MergeMain: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={D.c1}>
          <Clip src="clips/01-scene1.mp4" dur={D.c1} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={zoomBlur()}
          timing={springTiming({ config: { damping: 200 }, durationInFrames: T.zoom })}
        />

        <TransitionSeries.Sequence durationInFrames={D.c2}>
          <Clip src="clips/02-scene2.mp4" dur={D.c2} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={glitch()}
          timing={linearTiming({ durationInFrames: T.glitch })}
        />

        <TransitionSeries.Sequence durationInFrames={D.c3}>
          <Clip src="clips/03-scene3.mp4" dur={D.c3} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={whipPan()}
          timing={linearTiming({ durationInFrames: T.whip })}
        />

        <TransitionSeries.Sequence durationInFrames={D.c5}>
          <Clip src="clips/04-scene5.mp4" dur={D.c5} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={bloom()}
          timing={linearTiming({ durationInFrames: T.bloom })}
        />

        <TransitionSeries.Sequence durationInFrames={D.c8}>
          <Clip src="clips/05-scene8.mp4" dur={D.c8} />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* motion-graphics grade, painted above the footage */}
      <Grade />
      <Grain />
      <Letterbox />
      <HudFrame />
      <ProgressBar />
    </AbsoluteFill>
  );
};

export const MergeComposition: React.FC = () => {
  return (
    <Composition
      id="Merge"
      component={MergeMain}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
