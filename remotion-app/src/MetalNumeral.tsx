import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FilmGrain, PALETTE } from "./look-block";

export type MetalNumeralProps = {
  /** The valuation to engrave, e.g. "$4.5B". Its numeric part counts up. */
  value: string;
  /** The kicker beneath it, e.g. "PAPER NET WORTH". */
  label: string;
};

/* ------------------------------------------------------------------ *
 * Value parsing — split "$4.5B" into prefix / number / suffix so the
 * numeric part can count up while the currency + magnitude hold.
 * ------------------------------------------------------------------ */

const parseValue = (value: string) => {
  const m = value.match(/^(\D*?)(\d[\d,]*\.?\d*)(\D*)$/);
  if (!m) return { prefix: "", num: null as number | null, suffix: value, decimals: 0, group: false };
  const [, prefix, raw, suffix] = m;
  const group = raw.includes(",");
  const clean = raw.replace(/,/g, "");
  const decimals = clean.includes(".") ? clean.split(".")[1].length : 0;
  return { prefix, num: Number.parseFloat(clean), suffix, decimals, group };
};

const formatNumber = (n: number, decimals: number, group: boolean) => {
  const s = n.toFixed(decimals);
  if (!group) return s;
  const [i, d] = s.split(".");
  const gi = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return d ? `${gi}.${d}` : gi;
};

/* ------------------------------------------------------------------ *
 * Shared type styling
 * ------------------------------------------------------------------ */

const NUMERAL_FONT = "Georgia, 'Times New Roman', serif";

const numeralFace: React.CSSProperties = {
  fontFamily: NUMERAL_FONT,
  fontSize: 300,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: "-0.02em",
  margin: 0,
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: "'tnum' 1",
};

const metalFill: React.CSSProperties = {
  ...numeralFace,
  color: PALETTE.bone,
  backgroundImage: `linear-gradient(
    177deg,
    #FFFDF7 0%,
    ${PALETTE.bone} 38%,
    #B4AD9F 53%,
    #F4EFE5 68%,
    #CFC8BA 100%
  )`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

/* ------------------------------------------------------------------ *
 * Atmosphere — a breathing oxblood glow behind the figure plus a
 * vignette that keeps the frame reading near-black at the edges.
 * ------------------------------------------------------------------ */

const Atmosphere: React.FC<{ rim: number }> = ({ rim }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const breath = 0.5 + 0.5 * Math.sin(t * 0.7);
  const glowOpacity = 0.08 + 0.09 * breath + rim * 0.16;
  const glowScale = 1 + 0.07 * breath;

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 1500,
            height: 1500,
            opacity: glowOpacity,
            transform: `scale(${glowScale})`,
            background: `radial-gradient(circle at center, ${PALETTE.oxblood} 0%, rgba(122,22,14,0.35) 32%, transparent 62%)`,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 70% at center, transparent 42%, ${PALETTE.ground} 100%)`,
          opacity: 0.92,
        }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ *
 * Embers — deterministic drifting motes. Reflective warm-bone dust with
 * a minority of oxblood glowing embers, looping up through the frame.
 * ------------------------------------------------------------------ */

const Embers: React.FC<{
  count: number;
  seed: string;
  sizeMul: number;
  parallax: number;
  cameraX: number;
}> = ({ count, seed, sizeMul, parallax, cameraX }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  const margin = 100;
  const range = height + margin * 2;

  return (
    <AbsoluteFill style={{ transform: `translateX(${cameraX * parallax}px)` }}>
      {Array.from({ length: count }).map((_, i) => {
        const k = `${seed}-${i}`;
        const x0 = random(`x${k}`) * width;
        const baseY = random(`y${k}`) * range;
        const size = (1.4 + random(`s${k}`) * 3.4) * sizeMul;
        const speed = 10 + random(`v${k}`) * 32;
        const driftAmp = 8 + random(`d${k}`) * 26;
        const driftFreq = 0.15 + random(`f${k}`) * 0.45;
        const phase = random(`p${k}`) * Math.PI * 2;
        const glow = random(`g${k}`) > 0.72;

        let y = baseY - speed * t;
        y = ((y % range) + range) % range - margin;
        const x = x0 + Math.sin(t * driftFreq * Math.PI * 2 + phase) * driftAmp;
        const twinkle = 0.55 + 0.45 * Math.sin(t * (0.8 + random(`tw${k}`)) + phase);
        const opacity = (glow ? 0.3 : 0.12) * twinkle;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: glow ? PALETTE.oxblood : PALETTE.bone,
              opacity,
              boxShadow: glow ? `0 0 ${size * 4}px ${PALETTE.oxblood}` : "none",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ *
 * Frame chrome — registration brackets + metadata that draw in at the
 * corners, giving the beat a measured, dossier-like frame.
 * ------------------------------------------------------------------ */

const Bracket: React.FC<{
  corner: "tl" | "tr" | "bl" | "br";
  progress: number;
}> = ({ corner, progress }) => {
  const len = 64 * progress;
  const thick = 2;
  const v = corner[0] === "t" ? { top: 56 } : { bottom: 56 };
  const h = corner[1] === "l" ? { left: 72 } : { right: 72 };
  const line: React.CSSProperties = {
    position: "absolute",
    backgroundColor: PALETTE.bone,
    opacity: 0.55,
  };
  return (
    <>
      <div style={{ ...line, ...v, ...h, width: len, height: thick }} />
      <div style={{ ...line, ...v, ...h, width: thick, height: len }} />
    </>
  );
};

const FrameChrome: React.FC<{ progress: number }> = ({ progress }) => {
  const meta: React.CSSProperties = {
    position: "absolute",
    fontFamily: "'SF Mono', 'Roboto Mono', monospace",
    fontSize: 18,
    letterSpacing: "0.28em",
    color: PALETTE.bone,
    opacity: 0.4 * progress,
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Bracket corner="tl" progress={progress} />
      <Bracket corner="tr" progress={progress} />
      <Bracket corner="bl" progress={progress} />
      <Bracket corner="br" progress={progress} />
      <div style={{ ...meta, top: 60, left: 148 }}>VALUATION</div>
      <div style={{ ...meta, bottom: 60, right: 148 }}>16:9 · 30FPS</div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ *
 * MetalNumeral — one valuation beat, fully composed.
 * ------------------------------------------------------------------ */

export const MetalNumeral: React.FC<MetalNumeralProps> = ({ value, label }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { prefix, num, suffix, decimals, group } = parseValue(value);

  // --- Camera: heavily-damped settle + a slow ongoing push-in & drift ---
  const settle = spring({ frame, fps, config: { damping: 200 } });
  const cameraX = interpolate(settle, [0, 1], [-64, 0]) + interpolate(frame, [0, durationInFrames], [0, 18]);
  const push = interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
    easing: Easing.inOut(Easing.ease),
  });
  const introScale = interpolate(settle, [0, 1], [0.955, 1]);
  const stageScale = push * introScale;

  // --- Count-up: numeric part eases to target with a little weight ---
  const countProgress = spring({ frame, fps, delay: 4, config: { damping: 26, mass: 1.1 } });
  const current = (num ?? 0) * countProgress;
  const display = num == null ? value : `${prefix}${formatNumber(current, decimals, group)}${suffix}`;

  // --- Oxblood rim: flares on the reveal, then breathes at a low ember ---
  const flare = interpolate(frame, [0, 18, 46], [0, 1, 0.22], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const breathe = frame > 46 ? 0.07 * (0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 0.9)) : 0;
  const rim = Math.max(0, flare + breathe);

  // --- Specular sweeps: a bright glint crosses the glyphs, twice ---
  const sweep1Pos = interpolate(frame, [22, 64], [-25, 130], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sweep1Op = interpolate(frame, [22, 30, 58, 64], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sweep2Pos = interpolate(frame, [120, 162], [-25, 130], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const sweep2Op = interpolate(frame, [120, 128, 154, 162], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const glint = (pos: number, op: number): React.CSSProperties => ({
    ...numeralFace,
    position: "absolute",
    inset: 0,
    opacity: op,
    color: "transparent",
    WebkitTextFillColor: "transparent",
    backgroundImage: `linear-gradient(100deg, transparent ${pos - 9}%, rgba(255,253,247,0.95) ${pos}%, transparent ${pos + 9}%)`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
  });

  // --- Underline rule: draws out from centre ---
  const ruleWidth = interpolate(frame, [28, 72], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // --- Kicker: fades up and settles its tracking; oxblood status dot ---
  const labelOpacity = interpolate(frame, [46, 74], [0, 0.82], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const labelTrack = interpolate(frame, [46, 84], [0.62, 0.44], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dotPulse = 0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 1.6);

  // --- Frame chrome draw-in ---
  const chrome = interpolate(frame, [10, 48], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.ground }}>
      <Atmosphere rim={rim} />

      <Embers count={30} seed="back" sizeMul={0.8} parallax={0.35} cameraX={cameraX} />

      <FrameChrome progress={chrome} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            transform: `translateX(${cameraX}px) scale(${stageScale})`,
          }}
        >
          <div style={{ display: "inline-block" }}>
            {/* figure box */}
            <div style={{ position: "relative", display: "inline-block" }}>
              {/* Oxblood emissive rim — the only colour light in the frame. */}
              <div
                aria-hidden
                style={{
                  ...numeralFace,
                  position: "absolute",
                  inset: 0,
                  opacity: rim,
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                  WebkitTextStrokeWidth: 2,
                  WebkitTextStrokeColor: PALETTE.oxblood,
                  textShadow: [
                    `0 0 16px ${PALETTE.oxblood}`,
                    `0 0 40px ${PALETTE.oxblood}`,
                    `0 0 78px ${PALETTE.oxblood}`,
                  ].join(", "),
                }}
              >
                {display}
              </div>

              {/* Warm-bone metal face. */}
              <div style={metalFill}>{display}</div>

              {/* Specular glints. */}
              <div aria-hidden style={glint(sweep1Pos, sweep1Op)}>{display}</div>
              <div aria-hidden style={glint(sweep2Pos, sweep2Op)}>{display}</div>

              {/* Floor reflection — a soft sheen off the near-black ground. */}
              <div
                aria-hidden
                style={{
                  ...metalFill,
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  transform: "scaleY(-1)",
                  transformOrigin: "top",
                  opacity: 0.16,
                  filter: "blur(1px)",
                  WebkitMaskImage: "linear-gradient(to top, transparent 52%, rgba(0,0,0,0.7) 100%)",
                  maskImage: "linear-gradient(to top, transparent 52%, rgba(0,0,0,0.7) 100%)",
                }}
              >
                {display}
              </div>
            </div>

            {/* Underline rule. */}
            <div
              style={{
                height: 2,
                marginTop: 30,
                transform: `scaleX(${ruleWidth})`,
                transformOrigin: "center",
                background: `linear-gradient(90deg, transparent, ${PALETTE.bone} 22%, ${PALETTE.bone} 78%, transparent)`,
                boxShadow: `0 0 12px ${PALETTE.oxblood}`,
                opacity: 0.7,
              }}
            />
          </div>

          {/* Kicker. */}
          <div
            style={{
              marginTop: 34,
              display: "flex",
              alignItems: "center",
              gap: 18,
              opacity: labelOpacity,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                backgroundColor: PALETTE.oxblood,
                boxShadow: `0 0 10px ${PALETTE.oxblood}`,
                opacity: 0.6 + 0.4 * dotPulse,
              }}
            />
            <span
              style={{
                fontFamily: "'Helvetica Neue', Arial, sans-serif",
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: `${labelTrack}em`,
                textIndent: `${labelTrack}em`,
                color: PALETTE.bone,
              }}
            >
              {label}
            </span>
          </div>
        </div>
      </AbsoluteFill>

      {/* Front embers for depth, above the figure. */}
      <Embers count={14} seed="front" sizeMul={1.5} parallax={0.7} cameraX={cameraX} />

      <FilmGrain />
    </AbsoluteFill>
  );
};
