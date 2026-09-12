import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ---- palette ----
const GROUND = "#0B0B0C";
const GRAPHITE = "#3A3A3E";
const METAL = "#C9C4BA";
const OXBLOOD = "#7A160E";
const BONE = "#EDE8DD";

// ---- deterministic PRNG (mulberry32) — seeded once, module scope, so dust
// positions are identical frame-to-frame and across re-renders. No
// Math.random() anywhere. ----
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(84621);
const DUST_COUNT = 22;
const DUST = Array.from({ length: DUST_COUNT }).map(() => ({
  x: 80 + rand() * 1760,
  y: 460 + rand() * 560,
  size: 2 + rand() * 3,
  driftX: (rand() - 0.5) * 70,
  driftY: -30 - rand() * 55,
  peakFrame: 10 + rand() * 56, // each mote's own drift apex, spread across the shot
  opacity: 0.08 + rand() * 0.16,
}));

// ---- eye geometry (dominates the right two-thirds; ~55% of frame width) ----
const EYE_D = 1056;
const EYE_CX = 1280; // centered on the right optical third
const EYE_CY = 442; // bleeds slightly off the top; leaves room for the caption
const RING_D = 700;
const RING_BORDER = 42;
const PUPIL_D = 320;
const GLOW_D = 860;
const BEVEL_D = 1000;

const clampOpts = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const Shot08Iris: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ---- ambient push: a barely-visible scale drift for the WHOLE duration,
  // sitting underneath every other motion so nothing ever reads as frozen ----
  const ambientScale = interpolate(
    frame,
    [0, durationInFrames - 1],
    [1.0, 1.05],
    clampOpts,
  );

  // ======================================================
  // Beat 1 (f0-f11 / 0-0.46s) — the die is THROWN: it enters from off-frame
  // with real height, arcs through the air on a launch-then-gravity curve
  // (rise decelerating, fall accelerating — two separate interpolate()
  // calls rather than one, since a single easing can't shape both halves
  // of a parabola), spinning through several full turns while airborne,
  // and lands with a back-out settle bounce. A contact shadow (driven by
  // how far off the ground it currently is) grows and darkens as it
  // lands, selling the height instead of just a flat side-to-side slide.
  // ======================================================
  const THROW_START_X = -150;
  const THROW_START_Y = -50;
  const THROW_APEX_Y = -210;
  const APEX_FRAME = 5;

  const dieX = interpolate(frame, [0, 11], [THROW_START_X, 0], {
    ...clampOpts,
    easing: Easing.out(Easing.quad),
  });
  const riseY = interpolate(frame, [0, APEX_FRAME], [THROW_START_Y, THROW_APEX_Y], {
    ...clampOpts,
    easing: Easing.out(Easing.quad), // launched: decelerates going up
  });
  const fallY = interpolate(frame, [APEX_FRAME, 11], [THROW_APEX_Y, 0], {
    ...clampOpts,
    easing: Easing.in(Easing.quad), // gravity: accelerates coming down
  });
  const dieY = frame <= APEX_FRAME ? riseY : fallY;

  const dieRotate = interpolate(frame, [0, 11], [900, -6], {
    ...clampOpts,
    easing: Easing.out(Easing.back(1.5)),
  });
  const dieScale = interpolate(frame, [0, 11], [0.55, 1], {
    ...clampOpts,
    easing: Easing.out(Easing.back(1.5)),
  });

  // contact shadow: smallest/faintest at the apex (furthest from the
  // ground), largest/darkest the instant it lands
  const heightAboveGround = Math.abs(dieY);
  const dieShadowScale = interpolate(heightAboveGround, [0, 280], [1, 0.32], clampOpts);
  const dieShadowOpacity = interpolate(heightAboveGround, [0, 280], [0.55, 0.1], clampOpts);

  // ======================================================
  // Beat 3 (f34-f36 / 1.4-1.5s, sync frame f34) — die dims a hair as it
  // loses the frame's attention
  // ======================================================
  const dieOpacity = interpolate(frame, [34, 36], [1, 0.6], clampOpts);

  // ======================================================
  // Beat 2 (f12-f33 / 0.5-1.4s) — the oxblood ring irises open via a
  // clip-path circle() reveal, eased (not linear) so the growth stays
  // visible across the window rather than resolving in a few frames.
  // ======================================================
  const openPct = interpolate(frame, [12, 33], [0, 100], {
    ...clampOpts,
    easing: Easing.out(Easing.cubic),
  });

  // specular glint travels the bevel in the same window (fades in, sweeps,
  // fades out — three keyframes, so the input range needs a third point too)
  const glintMid = (12 + 33) / 2;
  const glintOpacity = interpolate(frame, [12, glintMid, 33], [0, 1, 0], clampOpts);
  const glintAngle = interpolate(frame, [12, 33], [-90, 270], {
    ...clampOpts,
    easing: Easing.inOut(Easing.quad),
  });

  // ======================================================
  // Beat 3 (f34-f36, sync frame f34) — the instant the iris finishes
  // opening it snaps to full brightness with a hard overshoot-and-settle
  // scale punch. spring() is the physically-felt primitive for this; its
  // natural rest value is 1, so the punch is built from how far it swings
  // ABOVE 1 during the overshoot (clamped below so there's no dip before
  // frame 34), scaled to land the peak near ~1.10 and settle back at 1.0.
  // ======================================================
  const rawSpring = spring({
    frame: frame - 34,
    fps,
    config: { damping: 10, stiffness: 200 },
  });
  const eyeScale = 1 + Math.max(0, rawSpring - 1) * 0.333;

  const flashOpacity = interpolate(frame, [34, 35, 40], [0, 1, 0], clampOpts);

  // ======================================================
  // Beat 4 (f37-f40 / 1.55-1.7s) — caption settles in beneath the eye, a
  // beat after the impact, never simultaneously with it
  // ======================================================
  const captionOpacity = interpolate(frame, [37, 40], [0, 1], clampOpts);
  const captionY = interpolate(frame, [37, 40], [12, 0], clampOpts);

  // ======================================================
  // f41-f69 (1.7-2.9s) — sustained stretch: the ring breathes via a
  // sine-shaped interpolate across small frame windows; ambient scale and
  // dust (below) already run the whole duration, so nothing here is dead
  // air.
  // ======================================================
  const ringBreath = interpolate(
    frame,
    [41, 48, 55, 62, 69],
    [1, 0.9, 1, 0.9, 1],
    { ...clampOpts, easing: Easing.inOut(Easing.sin) },
  );

  // f70-f76 (2.9-3.2s) — everything above naturally holds at its settled
  // value here; dust keeps drifting (below) so the final frames stay alive.

  return (
    <AbsoluteFill style={{ backgroundColor: GROUND, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${ambientScale})`,
          transformOrigin: "50% 50%",
        }}
      >
        {/* ---------------- dust ---------------- */}
        {DUST.map((d, i) => {
          const dx = interpolate(frame, [0, d.peakFrame, durationInFrames - 1], [0, d.driftX, 0], clampOpts);
          const dy = interpolate(frame, [0, d.peakFrame, durationInFrames - 1], [0, d.driftY, 0], clampOpts);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: d.x,
                top: d.y,
                width: d.size,
                height: d.size,
                borderRadius: "50%",
                background: BONE,
                opacity: d.opacity,
                transform: `translate(${dx}px, ${dy}px)`,
              }}
            />
          );
        })}

        {/* contact shadow — stays on the ground line; only its size/opacity
            track how far off the ground the die currently is */}
        <div
          style={{
            position: "absolute",
            left: 260 + 50,
            top: 860 + 96,
            width: 90,
            height: 22,
            marginLeft: -45,
            transform: `translateX(${dieX}px) scale(${dieShadowScale})`,
            borderRadius: "50%",
            background: "radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 72%)",
            opacity: dieShadowOpacity,
          }}
        />

        {/* ---------------- die (lower-left, subordinate) ---------------- */}
        <div
          style={{
            position: "absolute",
            left: 260,
            top: 860,
            width: 100,
            height: 100,
            opacity: dieOpacity,
            transform: `translate(${dieX}px, ${dieY}px) rotate(${dieRotate}deg) scale(${dieScale})`,
            borderRadius: 12,
            background: `linear-gradient(155deg, #4b4b50 0%, ${GRAPHITE} 45%, #262629 100%)`,
            boxShadow: "inset 0 0 0 1px rgba(237,232,221,0.06), 0 12px 20px rgba(0,0,0,0.55)",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gridTemplateRows: "repeat(3, 1fr)",
            padding: 16,
          }}
        >
          {[
            [1, 1],
            [3, 1],
            [1, 2],
            [3, 2],
            [1, 3],
            [3, 3],
          ].map(([col, row], i) => (
            <div
              key={i}
              style={{
                gridColumn: col,
                gridRow: row,
                alignSelf: "center",
                justifySelf: "center",
                width: 13,
                height: 13,
                borderRadius: "50%",
                background:
                  "radial-gradient(35% 35% at 35% 32%, #cfc9bc 0%, #8f8a80 55%, #57534c 100%)",
              }}
            />
          ))}
        </div>

        {/* ---------------- mechanical iris/eye ---------------- */}
        <div
          style={{
            position: "absolute",
            left: EYE_CX - (EYE_D / 2) * eyeScale,
            top: EYE_CY - (EYE_D / 2) * eyeScale,
            width: EYE_D * eyeScale,
            height: EYE_D * eyeScale,
          }}
        >
          {/* brushed dark metal socket */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `
                repeating-linear-gradient(98deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px),
                radial-gradient(60% 56% at 38% 32%, ${METAL} 0%, #8f8a80 34%, #55524a 62%, #201f1d 100%)
              `,
              boxShadow: "inset 0 0 0 2px rgba(237,232,221,0.12), 0 30px 70px rgba(0,0,0,0.6)",
            }}
          />

          {/* machined bevel rim */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: BEVEL_D,
              height: BEVEL_D,
              marginLeft: -BEVEL_D / 2,
              marginTop: -BEVEL_D / 2,
              borderRadius: "50%",
              border: "3px solid transparent",
              background: `conic-gradient(from 220deg, rgba(237,232,221,0.4) 0deg, rgba(237,232,221,0.06) 70deg, rgba(0,0,0,0.35) 150deg, rgba(237,232,221,0.14) 230deg, rgba(237,232,221,0.4) 360deg) border-box`,
              WebkitMask: "linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
          />

          {/* soft emissive glow behind the ring */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: GLOW_D,
              height: GLOW_D,
              marginLeft: -GLOW_D / 2,
              marginTop: -GLOW_D / 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(122,22,14,0.65) 0%, rgba(122,22,14,0.28) 46%, rgba(122,22,14,0) 72%)`,
              filter: "blur(16px)",
              opacity: interpolate(frame, [12, 33], [0, 1], {
                ...clampOpts,
                easing: Easing.out(Easing.cubic),
              }),
            }}
          />

          {/* the ring itself — emissive stroke only, revealed via clip-path.
              Its opacity is driven by ringBreath, which (thanks to
              extrapolateLeft: 'clamp') is simply 1 for every frame before
              41, then does the sine-shaped breathe from f41-f69, then
              holds at 1 again afterward — one expression covers all three
              phases without a duplicate element. */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: RING_D,
              height: RING_D,
              marginLeft: -RING_D / 2,
              marginTop: -RING_D / 2,
              borderRadius: "50%",
              border: `${RING_BORDER}px solid ${OXBLOOD}`,
              boxShadow: `0 0 50px 8px rgba(122,22,14,0.6), inset 0 0 36px 6px rgba(122,22,14,0.45)`,
              clipPath: `circle(${openPct}% at 50% 50%)`,
              opacity: ringBreath,
            }}
          />

          {/* impact flash — the instant the iris snaps to full brightness */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: RING_D,
              height: RING_D,
              marginLeft: -RING_D / 2,
              marginTop: -RING_D / 2,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,214,200,0.85) 0%, rgba(230,120,100,0.35) 45%, rgba(230,120,100,0) 75%)",
              mixBlendMode: "screen",
              opacity: flashOpacity,
            }}
          />

          {/* pupil — always on top, unaffected by the reveal */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: PUPIL_D,
              height: PUPIL_D,
              marginLeft: -PUPIL_D / 2,
              marginTop: -PUPIL_D / 2,
              borderRadius: "50%",
              background: "radial-gradient(50% 50% at 42% 38%, #1c1c1e 0%, #0a0a0b 60%, #000 100%)",
              boxShadow: "inset 0 0 34px 8px rgba(0,0,0,0.8)",
            }}
          />

          {/* specular glint traveling the bevel */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: BEVEL_D,
              height: BEVEL_D,
              marginLeft: -BEVEL_D / 2,
              marginTop: -BEVEL_D / 2,
              transform: `rotate(${glintAngle}deg)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                width: 30,
                height: 30,
                marginLeft: -15,
                marginTop: -4,
                borderRadius: "50%",
                background:
                  "radial-gradient(50% 50% at 50% 50%, #ffffff 0%, rgba(237,232,221,0.6) 55%, rgba(237,232,221,0) 100%)",
                opacity: glintOpacity,
              }}
            />
          </div>
        </div>

        {/* ---------------- caption ---------------- */}
        <div
          style={{
            position: "absolute",
            left: EYE_CX,
            top: 965,
            transform: `translate(-50%, ${captionY}px)`,
            opacity: captionOpacity,
            color: BONE,
            fontFamily: "Helvetica Neue, Arial, system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 50,
            letterSpacing: "0.05em",
            whiteSpace: "nowrap",
          }}
        >
          THEY GUESS. IT DOESN&rsquo;T.
        </div>
      </AbsoluteFill>

      {/* film-grain overlay — a global post effect, deliberately kept
          outside the ambient-scaled container so it doesn't zoom with the
          scene; static seeded texture (inline SVG, not a CSS
          background-image — Remotion's lint forbids that as an
          async-loading risk in frame capture) with a subtle frame-driven
          opacity breathe so the final hold still reads as alive, not
          frozen */}
      <svg
        width={1920}
        height={1080}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: interpolate(
            frame,
            [0, 20, 40, 60, durationInFrames - 1],
            [0.1, 0.14, 0.1, 0.14, 0.11],
            { ...clampOpts, easing: Easing.inOut(Easing.sin) },
          ),
        }}
      >
        <filter id="grain-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves={3} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain-noise)" />
      </svg>
    </AbsoluteFill>
  );
};
