/**
 * KineticIntro — Beat-Synced Kinetic Intro (1080p, 25s / 750 frames @ 30fps)
 * ---------------------------------------------------------------------------
 * Money-doc / editorial register: dark dimensional metal, single gold accent,
 * heavy grotesk display type over a mono utility face. Every entrance, exit
 * and accent is driven off a single beat grid — nothing is hand-timed.
 *
 * SETUP
 *   npm install remotion @remotion/cli @remotion/google-fonts \
 *               react react-dom
 *   # place two audio files (swap points):
 *   #   public/music.mp3   — music bed  (played at ~0.6 volume)
 *   #   public/vo.mp3      — VO narration (full volume, enters on a beat)
 *
 * PREVIEW
 *   npx remotion studio
 *
 * RENDER
 *   npx remotion render KineticIntro out/KineticIntro.mp4
 *
 * RE-KEYING
 *   • Retune tempo: change BPM (one line) — beat()/grid re-derive.
 *   • Re-time to a real VO stress map: edit the ACTS start beats and the
 *     local beat indices inside each act.
 *   • Edit copy/target: see COPY and COUNT_TARGET below.
 */

import { loadFont } from "@remotion/fonts";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// --- Fonts (heavy grotesk display + mono utility) --------------------------
// Self-hosted woff2 (public/fonts) loaded via @remotion/fonts, which wraps
// delayRender() so the render waits for the faces before snapshotting. Swap
// these for `@remotion/google-fonts` if you prefer fetching from Google.
const DISPLAY = "Archivo";
const MONO = "JetBrains Mono";
loadFont({
  family: DISPLAY,
  url: staticFile("fonts/archivo-800.woff2"),
  weight: "800",
});
loadFont({
  family: MONO,
  url: staticFile("fonts/jetbrainsmono-500.woff2"),
  weight: "500",
});

// ===========================================================================
// BEAT GRID — the single source of truth for all timing
// ===========================================================================
const FPS = 30;
const BPM = 120; // ← retune here; everything below re-derives (one-line change)
const FRAMES_PER_BEAT = Math.round((FPS * 60) / BPM); // 120 BPM @ 30fps = 15

/** The ONE timing helper: beat index → frame. */
const beat = (b) => b * FRAMES_PER_BEAT;

// Shared motion language: one slow-out easing family + one locked, deliberately
// slow speed register (entrances/exits span multiple beats).
const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const ENTER_BEATS = 2.4; // "uncomfortably slow" in
const EXIT_BEATS = 2.0; // and out

// ---------------------------------------------------------------------------
// EDITABLE CONTENT — placeholder money-doc copy
// ---------------------------------------------------------------------------
const COPY = {
  eyebrow: "CASE FILE · 07",
  hookA: "THE MONEY MOVED",
  hookB: "BEFORE ANYONE NOTICED",
  numberEyebrow: "TOTAL EXTRACTED",
  numberSuffix: "IN 18 MONTHS",
  numberSupport: "Routed through nine shell entities.",
  turnA: "IT WAS NEVER",
  turnB: "ABOUT THE MONEY",
  logo: "OBIOBI",
  cta: "THE FULL BREAKDOWN →",
};
const COUNT_TARGET = 47000000; // ← the key figure the count-up snaps to

// Act windows on the GLOBAL beat grid. Each act is a <Sequence> whose start is
// a multiple of the beat, so local beat indices inside it stay grid-aligned.
const ACTS = {
  hook: { start: beat(0), len: beat(17) },
  number: { start: beat(15), len: beat(20) },
  turn: { start: beat(33), len: beat(15) },
  outro: { start: beat(46), len: beat(50) - beat(46) + FRAMES_PER_BEAT },
};
const VO_START = beat(2); // narration enters on the grid

// --- Palette ---------------------------------------------------------------
const INK = "#0a0a0c";
const STEEL_LO = "#15171c";
const STEEL_HI = "#2c313b";
const GOLD = "#c8a24a";
const GOLD_HI = "#ecd18a";
const TEXT = "#f2f1ec";

// ===========================================================================
// HOOKS — factored, reusable motion primitives
// ===========================================================================

/** Subtle scale spike (~5%) that decays within each beat: on-screen breathing. */
function useBeatPulse(amp = 0.05) {
  const f = useCurrentFrame();
  const phase = (f % FRAMES_PER_BEAT) / FRAMES_PER_BEAT; // 0 at downbeat → 1
  const spike = Math.pow(1 - phase, 3); // sharp at the downbeat, decays out
  return 1 + amp * spike; // amplitude band 3–6%
}

/**
 * Slide an element in (and optionally back out) along ONE clean vector.
 * All timing is expressed in beats; the shared EASE gives every move the
 * same slow-out feel.
 */
function useSlide({
  inBeat,
  outBeat = null,
  axis = "x",
  from = -220,
  enter = ENTER_BEATS,
  exit = EXIT_BEATS,
}) {
  const f = useCurrentFrame();
  const eIn0 = beat(inBeat);
  const eIn1 = beat(inBeat) + enter * FRAMES_PER_BEAT;
  let value;
  let opacity;
  if (outBeat === null) {
    value = interpolate(f, [eIn0, eIn1], [from, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE,
    });
    opacity = interpolate(f, [eIn0, eIn1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  } else {
    const oIn0 = beat(outBeat);
    const oIn1 = beat(outBeat) + exit * FRAMES_PER_BEAT;
    // Exits continue along the same vector (never back the way it came).
    value = interpolate(f, [eIn0, eIn1, oIn0, oIn1], [from, 0, 0, -from], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE,
    });
    opacity = interpolate(f, [eIn0, eIn1, oIn0, oIn1], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  const transform = axis === "x" ? `translateX(${value}px)` : `translateY(${value}px)`;
  return { transform, opacity, value };
}

/** Count from 0 → target across beats; rounds each frame so it snaps on the
 * end downbeat. */
function useCountUp(target, startBeat, endBeat) {
  const f = useCurrentFrame();
  const p = interpolate(f, [beat(startBeat), beat(endBeat)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  return Math.round(p * target);
}

/** Reveal via clip-path wipe (left → right). */
function useWipe(inBeat, enter = ENTER_BEATS) {
  const f = useCurrentFrame();
  const r = interpolate(
    f,
    [beat(inBeat), beat(inBeat) + enter * FRAMES_PER_BEAT],
    [0, 100],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE },
  );
  return `inset(0 ${100 - r}% 0 0)`;
}

// ===========================================================================
// CONTINUITY MOTIF — persists across every hard cut (rendered at root, global
// frame): a drifting metal-dust field + a gold rim-light bar sweeping the floor.
// ===========================================================================

// Deterministic dust motes (seeded so renders are reproducible).
const DUST = Array.from({ length: 90 }, (_, i) => {
  const r = (n) => {
    const x = Math.sin(i * 97.13 + n * 13.71) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    x: r(1),
    y: r(2),
    size: 0.6 + r(3) * 2.2,
    speed: 0.15 + r(4) * 0.5,
    amp: 8 + r(5) * 26,
    phase: r(6) * Math.PI * 2,
  };
});

const ContinuityMotif = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Gold rim-light bar sweeping the floor, looping every 8 beats.
  const sweep = (frame % beat(8)) / beat(8);
  const sweepX = interpolate(sweep, [0, 1], [-35, 135]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Metal-dust field */}
      {DUST.map((d, i) => {
        const drift = (frame * d.speed) % (height + 60);
        const y = (d.y * height + drift) % (height + 60) - 30;
        const x = d.x * width + Math.sin(frame * 0.01 * d.speed + d.phase) * d.amp;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: d.size,
              height: d.size,
              borderRadius: "50%",
              background: GOLD_HI,
              opacity: 0.08 + d.size * 0.03,
              filter: "blur(0.5px)",
            }}
          />
        );
      })}

      {/* Gold rim-light bar sweeping across the low floor */}
      <div
        style={{
          position: "absolute",
          bottom: "16%",
          left: `${sweepX}%`,
          width: "42%",
          height: 3,
          transform: "translateX(-50%)",
          background: `linear-gradient(90deg, transparent, ${GOLD_HI}, transparent)`,
          filter: "blur(2px)",
          opacity: 0.55,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "16%",
          left: `${sweepX}%`,
          width: "50%",
          height: 130,
          transform: "translateX(-50%)",
          background: `radial-gradient(ellipse at center, ${GOLD}33, transparent 70%)`,
          filter: "blur(12px)",
          opacity: 0.5,
        }}
      />
    </AbsoluteFill>
  );
};

// --- Dimensional stage dressing (static): floor, rim light, vignette --------
const Stage = () => (
  <AbsoluteFill>
    {/* Low horizon: deep foreground floor anchor */}
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${INK} 0%, #0c0e13 58%, #040406 100%)`,
      }}
    />
    {/* Dimensional rim light from upper-right */}
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 78% 8%, ${STEEL_HI}55 0%, transparent 45%)`,
      }}
    />
    {/* Foreground vignette for depth */}
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 50% 42%, transparent 38%, rgba(0,0,0,0.72) 100%)",
      }}
    />
  </AbsoluteFill>
);

// --- Reusable editorial metal panel ----------------------------------------
const Panel = ({ style }) => (
  <div
    style={{
      background: `linear-gradient(135deg, ${STEEL_HI} 0%, ${STEEL_LO} 55%, #0d0f13 100%)`,
      boxShadow: `inset 0 1px 0 ${STEEL_HI}, inset 0 0 0 1px rgba(255,255,255,0.04), 0 30px 80px rgba(0,0,0,0.6)`,
      borderTop: `2px solid ${GOLD}`,
      ...style,
    }}
  />
);

// Shared type styles
const displayStyle = (size) => ({
  fontFamily: DISPLAY,
  fontWeight: 800,
  fontSize: size,
  lineHeight: 0.92,
  letterSpacing: -2,
  color: TEXT,
  margin: 0,
  textTransform: "uppercase",
});
const labelStyle = {
  fontFamily: MONO,
  fontWeight: 500,
  fontSize: 26,
  letterSpacing: 8,
  color: GOLD,
  textTransform: "uppercase",
};

// ===========================================================================
// ACT 1 — HOOK (local beats 0–15): panels slide in, headlines counter-slide,
// eyebrow wipes in.
// ===========================================================================
const ActHook = () => {
  const pulse = useBeatPulse();
  const leftPanel = useSlide({ inBeat: 0, outBeat: 12, axis: "x", from: -900 });
  const rightPanel = useSlide({ inBeat: 1, outBeat: 13, axis: "x", from: 900 });
  // Headlines on OPPOSING vectors: one on X, one on Y (one clean vector each).
  const hookA = useSlide({ inBeat: 3, outBeat: 13, axis: "x", from: -520 });
  const hookB = useSlide({ inBeat: 5, outBeat: 14, axis: "y", from: 340 });
  const eyebrowClip = useWipe(1);

  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 180px" }}>
      {/* Metal panels sliding in from both sides */}
      <Panel
        style={{
          position: "absolute",
          left: 0,
          top: "24%",
          width: 520,
          height: 360,
          transform: leftPanel.transform,
          opacity: leftPanel.opacity,
        }}
      />
      <Panel
        style={{
          position: "absolute",
          right: 0,
          top: "42%",
          width: 460,
          height: 300,
          transform: rightPanel.transform,
          opacity: rightPanel.opacity,
        }}
      />

      {/* Eyebrow label — clip-path wipe */}
      <div style={{ ...labelStyle, clipPath: eyebrowClip, marginBottom: 34 }}>
        {COPY.eyebrow}
      </div>

      {/* Counter-sliding headlines with beat-pulse breathing */}
      <h1
        style={{
          ...displayStyle(150),
          transform: `${hookA.transform} scale(${pulse})`,
          opacity: hookA.opacity,
          transformOrigin: "left center",
        }}
      >
        {COPY.hookA}
      </h1>
      <h1
        style={{
          ...displayStyle(150),
          color: GOLD_HI,
          transform: `${hookB.transform} scale(${pulse})`,
          opacity: hookB.opacity,
          transformOrigin: "left center",
        }}
      >
        {COPY.hookB}
      </h1>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ACT 2 — THE NUMBER (local beats 0–18): count-up snaps on a downbeat,
// support line rises from below.
// ===========================================================================
const ActNumber = () => {
  const pulse = useBeatPulse(0.06);
  const value = useCountUp(COUNT_TARGET, 1, 12); // reaches target ON beat 12
  const eyebrowClip = useWipe(0);
  const framePanel = useSlide({ inBeat: 0, outBeat: 17, axis: "y", from: -260 });
  const support = useSlide({ inBeat: 6, outBeat: 17, axis: "y", from: 160 });
  const numberOut = useSlide({ inBeat: 2, outBeat: 16, axis: "y", from: 60 });

  const formatted = "$" + value.toLocaleString("en-US");

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {/* Framing metal slab behind the figure */}
      <Panel
        style={{
          position: "absolute",
          width: 1500,
          height: 520,
          transform: framePanel.transform,
          opacity: framePanel.opacity * 0.9,
        }}
      />

      <div style={{ ...labelStyle, clipPath: eyebrowClip, marginBottom: 20 }}>
        {COPY.numberEyebrow}
      </div>

      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: 220,
          letterSpacing: -4,
          color: GOLD_HI,
          lineHeight: 1,
          opacity: numberOut.opacity,
          transform: `${numberOut.transform} scale(${pulse})`,
          textShadow: `0 0 60px ${GOLD}55`,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatted}
      </div>

      <div
        style={{
          ...displayStyle(60),
          color: "#9aa0ab",
          opacity: numberOut.opacity,
          letterSpacing: 2,
          marginTop: 30,
        }}
      >
        {COPY.numberSuffix}
      </div>

      {/* Supporting line rising from below */}
      <div
        style={{
          fontFamily: MONO,
          fontSize: 30,
          letterSpacing: 2,
          color: "#b9bcc4",
          marginTop: 40,
          transform: support.transform,
          opacity: support.opacity,
        }}
      >
        {COPY.numberSupport}
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ACT 3 — THE TURN (local beats 0–13): reframe headline pair, panels sweep.
// ===========================================================================
const ActTurn = () => {
  const pulse = useBeatPulse();
  const barLeft = useSlide({ inBeat: 0, outBeat: 12, axis: "x", from: -1200 });
  const barRight = useSlide({ inBeat: 1, outBeat: 12, axis: "x", from: 1200 });
  const turnA = useSlide({ inBeat: 2, outBeat: 12, axis: "x", from: 560 }); // X vector
  const turnB = useSlide({ inBeat: 5, outBeat: 13, axis: "y", from: 300 }); // Y vector

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      {/* Thin gold accent bars sweeping in from opposite sides */}
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: 0,
          width: "46%",
          height: 6,
          background: `linear-gradient(90deg, transparent, ${GOLD})`,
          transform: barLeft.transform,
          opacity: barLeft.opacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "62%",
          right: 0,
          width: "46%",
          height: 6,
          background: `linear-gradient(90deg, ${GOLD}, transparent)`,
          transform: barRight.transform,
          opacity: barRight.opacity,
        }}
      />

      <h1
        style={{
          ...displayStyle(130),
          transform: `${turnA.transform} scale(${pulse})`,
          opacity: turnA.opacity,
        }}
      >
        {COPY.turnA}
      </h1>
      <h1
        style={{
          ...displayStyle(130),
          color: GOLD_HI,
          transform: `${turnB.transform} scale(${pulse})`,
          opacity: turnB.opacity,
        }}
      >
        {COPY.turnB}
      </h1>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ACT 4 — OUTRO (local beats 0–4): logo lockup with spring + beat pulse, CTA.
// ===========================================================================
const ActOutro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = useBeatPulse(0.05);

  // Spring-driven logo entrance on the downbeat.
  const enter = spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.9, stiffness: 120 },
  });
  const logoScale = interpolate(enter, [0, 1], [0.7, 1]) * pulse;
  // Wipe starts on beat 1 and finishes well before the 750-frame end.
  const ctaClip = useWipe(1, 1.6);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: 200,
          letterSpacing: 6,
          color: TEXT,
          opacity: enter,
          transform: `scale(${logoScale})`,
          textShadow: `0 0 80px ${GOLD}44`,
        }}
      >
        {COPY.logo}
      </div>
      <div
        style={{
          width: 220,
          height: 3,
          background: GOLD,
          margin: "28px 0",
          transform: `scaleX(${enter})`,
        }}
      />
      <div style={{ ...labelStyle, color: GOLD_HI, clipPath: ctaClip }}>
        {COPY.cta}
      </div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ROOT SCENE — audio + continuity motif + beat-gridded acts
// ===========================================================================
export const KineticIntro = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: INK, overflow: "hidden" }}>
      {/* Audio — swap these two files for the real bed + VO. */}
      <Audio src={staticFile("music.mp3")} volume={0.6} />
      <Sequence from={VO_START}>
        <Audio src={staticFile("vo.mp3")} />
      </Sequence>

      {/* Static dimensional stage + persistent continuity motif */}
      <Stage />
      <ContinuityMotif />

      {/* Acts on the global beat grid (each Sequence starts on a downbeat) */}
      <Sequence from={ACTS.hook.start} durationInFrames={ACTS.hook.len}>
        <ActHook />
      </Sequence>
      <Sequence from={ACTS.number.start} durationInFrames={ACTS.number.len}>
        <ActNumber />
      </Sequence>
      <Sequence from={ACTS.turn.start} durationInFrames={ACTS.turn.len}>
        <ActTurn />
      </Sequence>
      <Sequence from={ACTS.outro.start} durationInFrames={ACTS.outro.len}>
        <ActOutro />
      </Sequence>
    </AbsoluteFill>
  );
};
