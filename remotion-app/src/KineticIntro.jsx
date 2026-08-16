/**
 * KineticIntro — Beat-Synced Kinetic Intro (1080p, 25s / 750 frames @ 30fps)
 * ---------------------------------------------------------------------------
 * Money-doc / editorial register: dark dimensional metal, single gold accent,
 * heavy grotesk display type over a mono utility face. Every entrance, exit
 * and accent is driven off a single 120 BPM beat grid — nothing hand-timed.
 *
 * Advanced motion layer:
 *   • A real 3D chrome hero (@remotion/three) rotating behind the type,
 *     catching gold key + steel-blue rim light, breathing on the beat.
 *   • A camera rig: slow push-in + parallax + a subtle downbeat shake.
 *   • Velocity-based motion blur on every slide (fast = smeared).
 *   • Gold spark bursts + a bloom flash on every downbeat.
 *   • Chromatic-split logo lockup on the outro.
 *
 * AUDIO
 *   public/music.mp3 — music bed (~0.6 vol)
 *   public/vo.mp3    — VO narration (full vol; lines pre-placed on the beats)
 *
 * SETUP   npm install remotion @remotion/cli @remotion/three @remotion/fonts \
 *                     three @react-three/fiber react react-dom
 * PREVIEW npx remotion studio
 * RENDER  npx remotion render KineticIntro out/KineticIntro.mp4
 *
 * RE-KEYING
 *   • Retune tempo: change BPM (one line) — beat()/grid re-derive.
 *   • Re-time to the VO stress map: edit the ACTS start beats + local indices.
 *   • Edit copy/target: see COPY and COUNT_TARGET below.
 */

import { loadFont } from "@remotion/fonts";
import { ThreeCanvas } from "@remotion/three";
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

// --- Fonts (self-hosted woff2 via @remotion/fonts; offline & reproducible) --
const DISPLAY = "Archivo";
const MONO = "JetBrains Mono";
loadFont({ family: DISPLAY, url: staticFile("fonts/archivo-800.woff2"), weight: "800" });
loadFont({ family: MONO, url: staticFile("fonts/jetbrainsmono-500.woff2"), weight: "500" });

// ===========================================================================
// BEAT GRID — single source of truth for all timing
// ===========================================================================
const FPS = 30;
const BPM = 120; // ← retune here; everything below re-derives (one-line change)
const FRAMES_PER_BEAT = Math.round((FPS * 60) / BPM); // 120 BPM @ 30fps = 15

/** The ONE timing helper: beat index → frame. */
const beat = (b) => b * FRAMES_PER_BEAT;

const EASE = Easing.bezier(0.16, 1, 0.3, 1); // shared slow-out family
const ENTER_BEATS = 2.4; // locked, deliberately slow speed register
const EXIT_BEATS = 2.0;

// ---------------------------------------------------------------------------
// EDITABLE CONTENT — placeholder money-doc copy (matches the VO lines)
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
const COUNT_TARGET = 47000000; // the key figure the count-up snaps to

// Act windows on the GLOBAL beat grid (each Sequence starts on a downbeat).
const ACTS = {
  hook: { start: beat(0), len: beat(17) },
  number: { start: beat(15), len: beat(20) },
  turn: { start: beat(33), len: beat(15) },
  outro: { start: beat(46), len: beat(50) - beat(46) + FRAMES_PER_BEAT },
};

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

/** Subtle scale spike (~5%) decaying within each beat: on-screen breathing. */
function useBeatPulse(amp = 0.05) {
  const f = useCurrentFrame();
  const phase = (f % FRAMES_PER_BEAT) / FRAMES_PER_BEAT;
  return 1 + amp * Math.pow(1 - phase, 3); // amplitude band 3–6%
}

/** Sharp global downbeat envelope (0..1) for flashes/sparks/shake. */
function useDownbeat() {
  const f = useCurrentFrame();
  const phase = (f % FRAMES_PER_BEAT) / FRAMES_PER_BEAT;
  return Math.pow(1 - phase, 4);
}

/**
 * Slide in (and optionally back out) along ONE clean vector. Also returns a
 * velocity-derived motion blur so fast moves smear.
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
  const keys = outBeat === null ? [eIn0, eIn1] : [eIn0, eIn1, beat(outBeat), beat(outBeat) + exit * FRAMES_PER_BEAT];
  const vals = outBeat === null ? [from, 0] : [from, 0, 0, -from];
  const opac = outBeat === null ? [0, 1] : [0, 1, 1, 0];
  const cfg = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE };

  const value = interpolate(f, keys, vals, cfg);
  const prev = interpolate(f - 1, keys, vals, cfg);
  const velocity = value - prev; // px/frame
  const blur = Math.min(7, Math.abs(velocity) * 0.12);
  const opacity = interpolate(f, keys, opac, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const transform = axis === "x" ? `translateX(${value}px)` : `translateY(${value}px)`;
  return { transform, opacity, value, velocity, blur };
}

/** Count 0 → target across beats; rounds each frame so it snaps on a downbeat. */
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
  const r = interpolate(f, [beat(inBeat), beat(inBeat) + enter * FRAMES_PER_BEAT], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  return `inset(0 ${100 - r}% 0 0)`;
}

// ===========================================================================
// 3D CHROME HERO — dimensional metal depth anchor (persists across cuts)
// ===========================================================================
const HeroKnot = () => {
  const frame = useCurrentFrame();
  const pulse = useBeatPulse(0.07);
  // Deterministic rotation from the frame (R3F's own ticker is real-time).
  return (
    <mesh rotation={[frame * 0.009, frame * 0.014, frame * 0.004]} scale={2.05 * pulse}>
      <torusKnotGeometry args={[1, 0.3, 140, 20]} />
      <meshStandardMaterial color="#8b909b" metalness={1} roughness={0.24} />
    </mesh>
  );
};

const Hero3D = ({ width, height }) => (
  <ThreeCanvas
    width={width}
    height={height}
    camera={{ position: [0, 0, 6], fov: 45 }}
    style={{ position: "absolute", inset: 0 }}
    gl={{ alpha: true, antialias: true }}
  >
    {/* Gold key + steel-blue rim + soft fill so the metal reads dimensional. */}
    <ambientLight intensity={0.28} />
    <directionalLight position={[5, 5, 5]} intensity={2.4} color={GOLD_HI} />
    <directionalLight position={[-6, -2, 2]} intensity={1.5} color="#3a6fd8" />
    <pointLight position={[0, 0, 5]} intensity={1.1} color="#ffffff" />
    <HeroKnot />
  </ThreeCanvas>
);

// ===========================================================================
// CONTINUITY MOTIF — drifting metal-dust + gold rim-light bar sweeping floor
// ===========================================================================
const DUST = Array.from({ length: 90 }, (_, i) => {
  const r = (n) => {
    const x = Math.sin(i * 97.13 + n * 13.71) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1), y: r(2), size: 0.6 + r(3) * 2.2, speed: 0.15 + r(4) * 0.5, amp: 8 + r(5) * 26, phase: r(6) * Math.PI * 2 };
});

const ContinuityMotif = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const sweep = (frame % beat(8)) / beat(8);
  const sweepX = interpolate(sweep, [0, 1], [-35, 135]);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {DUST.map((d, i) => {
        const drift = (frame * d.speed) % (height + 60);
        const y = ((d.y * height + drift) % (height + 60)) - 30;
        const x = d.x * width + Math.sin(frame * 0.01 * d.speed + d.phase) * d.amp;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: d.size, height: d.size, borderRadius: "50%", background: GOLD_HI, opacity: 0.08 + d.size * 0.03, filter: "blur(0.5px)" }} />
        );
      })}
      <div style={{ position: "absolute", bottom: "16%", left: `${sweepX}%`, width: "42%", height: 3, transform: "translateX(-50%)", background: `linear-gradient(90deg, transparent, ${GOLD_HI}, transparent)`, filter: "blur(2px)", opacity: 0.55 }} />
      <div style={{ position: "absolute", bottom: "16%", left: `${sweepX}%`, width: "50%", height: 130, transform: "translateX(-50%)", background: `radial-gradient(ellipse at center, ${GOLD}33, transparent 70%)`, filter: "blur(12px)", opacity: 0.5 }} />
    </AbsoluteFill>
  );
};

// ===========================================================================
// BEAT FX — gold spark bursts + bloom flash on every downbeat (global frame)
// ===========================================================================
const SPARKS = Array.from({ length: 26 }, (_, p) => {
  const r = (n) => {
    const x = Math.sin(p * 51.7 + n * 7.13) * 24019.31;
    return x - Math.floor(x);
  };
  return { angle: r(1) * Math.PI * 2, speed: 180 + r(2) * 260, size: 1 + r(3) * 2.4 };
});

const BeatFX = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const cx = width / 2;
  const cy = height / 2;
  const life = 0.5; // seconds

  const nodes = [];
  const maxBeat = Math.ceil(750 / FRAMES_PER_BEAT);
  for (let b = 0; b <= maxBeat; b++) {
    const bf = beat(b);
    const age = (frame - bf) / FPS;
    if (age < 0 || age > life) continue;
    const prog = age / life;
    for (let s = 0; s < SPARKS.length; s++) {
      const sp = SPARKS[s];
      const jitter = ((b * 31 + s * 17) % 13) / 13 - 0.5;
      const ang = sp.angle + jitter * 0.6;
      const dist = sp.speed * age * (1 - prog * 0.3);
      nodes.push(
        <circle key={`${b}-${s}`} cx={cx + Math.cos(ang) * dist} cy={cy + Math.sin(ang) * dist} r={Math.max(0, sp.size * (1 - prog))} fill={s % 3 === 0 ? "#ffffff" : GOLD_HI} opacity={(1 - prog) * 0.85} />,
      );
    }
  }
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height}>{nodes}</svg>
    </AbsoluteFill>
  );
};

const DownbeatBloom = () => {
  const db = useDownbeat();
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background: `radial-gradient(circle at 50% 46%, ${GOLD_HI}22 0%, transparent 45%)`,
        opacity: db * 0.5,
        mixBlendMode: "screen",
      }}
    />
  );
};

// ===========================================================================
// CAMERA RIG — slow push-in + parallax + subtle downbeat shake on all layers
// ===========================================================================
const CameraRig = ({ children }) => {
  const frame = useCurrentFrame();
  const db = useDownbeat();
  const scale = interpolate(frame, [0, 750], [1.04, 1.12], { easing: Easing.inOut(Easing.sin), extrapolateRight: "clamp" });
  const driftY = interpolate(frame, [0, 750], [14, -14], { extrapolateRight: "clamp" });
  const shakeX = Math.sin(frame * 1.7) * db * 4;
  const shakeY = Math.cos(frame * 1.9) * db * 4;
  return (
    <AbsoluteFill style={{ transform: `scale(${scale}) translate(${shakeX}px, ${driftY + shakeY}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

// --- Dimensional stage dressing (static) -----------------------------------
const Stage = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${INK} 0%, #0c0e13 58%, #040406 100%)` }} />
    <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 78% 8%, ${STEEL_HI}55 0%, transparent 45%)` }} />
    <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 42%, transparent 38%, rgba(0,0,0,0.72) 100%)" }} />
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
const labelStyle = { fontFamily: MONO, fontWeight: 500, fontSize: 26, letterSpacing: 8, color: GOLD, textTransform: "uppercase" };

// ===========================================================================
// ACT 1 — HOOK: panels slide in, headlines counter-slide, eyebrow wipes in.
// ===========================================================================
const ActHook = () => {
  const pulse = useBeatPulse();
  const leftPanel = useSlide({ inBeat: 0, outBeat: 12, axis: "x", from: -900 });
  const rightPanel = useSlide({ inBeat: 1, outBeat: 13, axis: "x", from: 900 });
  const hookA = useSlide({ inBeat: 3, outBeat: 13, axis: "x", from: -520 }); // X vector
  const hookB = useSlide({ inBeat: 5, outBeat: 14, axis: "y", from: 340 }); // Y vector
  const eyebrowClip = useWipe(1);

  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 180px" }}>
      <Panel style={{ position: "absolute", left: 0, top: "24%", width: 520, height: 360, transform: leftPanel.transform, opacity: leftPanel.opacity, filter: `blur(${leftPanel.blur}px)` }} />
      <Panel style={{ position: "absolute", right: 0, top: "42%", width: 460, height: 300, transform: rightPanel.transform, opacity: rightPanel.opacity, filter: `blur(${rightPanel.blur}px)` }} />

      <div style={{ ...labelStyle, clipPath: eyebrowClip, marginBottom: 34 }}>{COPY.eyebrow}</div>

      <h1 style={{ ...displayStyle(150), transform: `${hookA.transform} scale(${pulse})`, opacity: hookA.opacity, transformOrigin: "left center", filter: `blur(${hookA.blur}px)` }}>{COPY.hookA}</h1>
      <h1 style={{ ...displayStyle(150), color: GOLD_HI, transform: `${hookB.transform} scale(${pulse})`, opacity: hookB.opacity, transformOrigin: "left center", filter: `blur(${hookB.blur}px)` }}>{COPY.hookB}</h1>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ACT 2 — THE NUMBER: count-up snaps on a downbeat, support line rises.
// ===========================================================================
const ActNumber = () => {
  const pulse = useBeatPulse(0.06);
  const value = useCountUp(COUNT_TARGET, 1, 12); // reaches target ON beat 12
  const eyebrowClip = useWipe(0);
  // Exit by local beat 15 (→ global beat 30) so the turn enters a clear frame.
  const framePanel = useSlide({ inBeat: 0, outBeat: 15, axis: "y", from: -260 });
  const support = useSlide({ inBeat: 6, outBeat: 15, axis: "y", from: 160 });
  const numberOut = useSlide({ inBeat: 2, outBeat: 15, axis: "y", from: 60 });
  const formatted = "$" + value.toLocaleString("en-US");

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Panel style={{ position: "absolute", width: 1500, height: 520, transform: framePanel.transform, opacity: framePanel.opacity * 0.9, filter: `blur(${framePanel.blur}px)` }} />

      <div style={{ ...labelStyle, clipPath: eyebrowClip, marginBottom: 20 }}>{COPY.numberEyebrow}</div>

      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 220, letterSpacing: -4, color: GOLD_HI, lineHeight: 1, opacity: numberOut.opacity, transform: `${numberOut.transform} scale(${pulse})`, textShadow: `0 0 60px ${GOLD}55`, fontVariantNumeric: "tabular-nums" }}>{formatted}</div>

      <div style={{ ...displayStyle(60), color: "#9aa0ab", opacity: numberOut.opacity, letterSpacing: 2, marginTop: 30 }}>{COPY.numberSuffix}</div>

      <div style={{ fontFamily: MONO, fontSize: 30, letterSpacing: 2, color: "#b9bcc4", marginTop: 40, transform: support.transform, opacity: support.opacity, filter: `blur(${support.blur}px)` }}>{COPY.numberSupport}</div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ACT 3 — THE TURN: reframe headline pair, gold accent bars sweep.
// ===========================================================================
const ActTurn = () => {
  const pulse = useBeatPulse();
  // Exit by local beat 11 (→ global beat 46) so the outro enters a clear frame.
  const barLeft = useSlide({ inBeat: 0, outBeat: 11, axis: "x", from: -1200 });
  const barRight = useSlide({ inBeat: 1, outBeat: 11, axis: "x", from: 1200 });
  const turnA = useSlide({ inBeat: 2, outBeat: 11, axis: "x", from: 560 }); // X vector
  const turnB = useSlide({ inBeat: 5, outBeat: 11, axis: "y", from: 300 }); // Y vector

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "absolute", top: "38%", left: 0, width: "46%", height: 6, background: `linear-gradient(90deg, transparent, ${GOLD})`, transform: barLeft.transform, opacity: barLeft.opacity }} />
      <div style={{ position: "absolute", top: "62%", right: 0, width: "46%", height: 6, background: `linear-gradient(90deg, ${GOLD}, transparent)`, transform: barRight.transform, opacity: barRight.opacity }} />

      <h1 style={{ ...displayStyle(130), transform: `${turnA.transform} scale(${pulse})`, opacity: turnA.opacity, filter: `blur(${turnA.blur}px)` }}>{COPY.turnA}</h1>
      <h1 style={{ ...displayStyle(130), color: GOLD_HI, transform: `${turnB.transform} scale(${pulse})`, opacity: turnB.opacity, filter: `blur(${turnB.blur}px)` }}>{COPY.turnB}</h1>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ACT 4 — OUTRO: spring logo lockup with chromatic split + beat pulse, CTA.
// ===========================================================================
const ActOutro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = useBeatPulse(0.05);
  const db = useDownbeat();
  const enter = spring({ frame, fps, config: { damping: 12, mass: 0.9, stiffness: 120 } });
  const logoScale = interpolate(enter, [0, 1], [0.7, 1]) * pulse;
  const ctaClip = useWipe(1, 1.6);
  const split = 2 + db * 8; // chromatic aberration widens on the downbeat

  const logoBase = { position: "absolute", fontFamily: DISPLAY, fontWeight: 800, fontSize: 200, letterSpacing: 6, margin: 0 };

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "relative", opacity: enter, transform: `scale(${logoScale})` }}>
        {/* Chromatic-split copies (red/cyan) under the white master. */}
        <div style={{ ...logoBase, color: "#ff2d55", transform: `translateX(${-split}px)`, mixBlendMode: "screen", opacity: 0.9 }}>{COPY.logo}</div>
        <div style={{ ...logoBase, color: "#2dd4ff", transform: `translateX(${split}px)`, mixBlendMode: "screen", opacity: 0.9 }}>{COPY.logo}</div>
        <div style={{ ...logoBase, position: "relative", color: TEXT, textShadow: `0 0 80px ${GOLD}44` }}>{COPY.logo}</div>
      </div>
      <div style={{ width: 220, height: 3, background: GOLD, margin: "28px 0", transform: `scaleX(${enter})` }} />
      <div style={{ ...labelStyle, color: GOLD_HI, clipPath: ctaClip }}>{COPY.cta}</div>
    </AbsoluteFill>
  );
};

// ===========================================================================
// ROOT SCENE — audio + 3D hero + continuity + beat FX + gridded acts
// ===========================================================================
export const KineticIntro = () => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: INK, overflow: "hidden" }}>
      {/* Audio — VO lines are pre-placed on the beats inside the file. */}
      <Audio src={staticFile("music.mp3")} volume={0.6} />
      <Audio src={staticFile("vo.mp3")} />

      <Stage />

      <CameraRig>
        {/* 3D chrome hero behind a darkening scrim for depth */}
        <AbsoluteFill style={{ opacity: 0.6 }}>
          <Hero3D width={width} height={height} />
        </AbsoluteFill>
        <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 46%, rgba(6,8,14,0.55) 0%, rgba(4,5,9,0.86) 62%)" }} />

        <ContinuityMotif />

        {/* Acts on the global beat grid (each Sequence starts on a downbeat) */}
        <Sequence from={ACTS.hook.start} durationInFrames={ACTS.hook.len}><ActHook /></Sequence>
        <Sequence from={ACTS.number.start} durationInFrames={ACTS.number.len}><ActNumber /></Sequence>
        <Sequence from={ACTS.turn.start} durationInFrames={ACTS.turn.len}><ActTurn /></Sequence>
        <Sequence from={ACTS.outro.start} durationInFrames={ACTS.outro.len}><ActOutro /></Sequence>
      </CameraRig>

      {/* Beat accents sit above the rig so they read as camera-plane light. */}
      <BeatFX />
      <DownbeatBloom />

      {/* Film grain */}
      <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: 0.06, pointerEvents: "none" }}>
        <svg width="100%" height="100%">
          <filter id="kiGrain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
          <rect width="100%" height="100%" filter="url(#kiGrain)" />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
