import { CameraMotionBlur } from "@remotion/motion-blur";
import React from "react";
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile } from "remotion";

export const Video: React.FC<{
  file: string;
  style?: React.CSSProperties;
  volume?: number;
}> = ({ file, style, volume = 1 }) => (
  <OffthreadVideo
    src={staticFile(file)}
    volume={volume}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      ...style,
    }}
  />
);

const ease = Easing.inOut(Easing.cubic);

// ---------------------------------------------------------------------
// 1. Fluid Submersion Plunge — a growing, soft-edged radial reveal that
//    mimics a droplet's ripple spreading outward from the impact point.
// ---------------------------------------------------------------------
export const LIQUID_CENTER = { x: 42, y: 58 };

export const liquidOutgoingStyle = (rawProgress: number): React.CSSProperties => {
  const p = ease(rawProgress);
  const scale = interpolate(p, [0, 1], [1, 1.045]);
  const blur = interpolate(p, [0, 1], [0, 3]);
  const brightness = interpolate(p, [0, 1], [1, 0.82]);
  return {
    transform: `scale(${scale})`,
    filter: `blur(${blur}px) brightness(${brightness})`,
  };
};

export const liquidIncomingStyle = (rawProgress: number): React.CSSProperties => {
  const p = ease(rawProgress);
  const radius = interpolate(p, [0, 1], [0, 165]);
  const feather = interpolate(p, [0, 1], [10, 22]);
  const mask = `radial-gradient(circle at ${LIQUID_CENTER.x}% ${LIQUID_CENTER.y}%, black 0%, black ${Math.max(
    radius - feather,
    0,
  )}%, transparent ${radius}%)`;
  return { WebkitMaskImage: mask, maskImage: mask };
};

export const LiquidExtra: React.FC<{ progress: number }> = ({ progress }) => {
  const p = Easing.out(Easing.quad)(progress);
  const opacity = interpolate(p, [0, 0.18, 0.5, 1], [0, 0.55, 0.15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity,
        background: `radial-gradient(circle at ${LIQUID_CENTER.x}% ${LIQUID_CENTER.y}%, rgba(180,20,20,0.9) 0%, rgba(120,10,10,0.4) 30%, transparent 65%)`,
      }}
    />
  );
};

// ---------------------------------------------------------------------
// 2. Iris Silhouette & Keyhole Tunnel — a shrinking soft iris on the
//    outgoing clip, revealing the incoming clip beneath.
// ---------------------------------------------------------------------
export const irisOutgoingStyle = (rawProgress: number): React.CSSProperties => {
  const p = ease(rawProgress);
  const radius = interpolate(p, [0, 1], [160, 0]);
  const feather = 7;
  const mask = `radial-gradient(circle at 50% 50%, black 0%, black ${Math.max(
    radius - feather,
    0,
  )}%, transparent ${radius}%)`;
  return { WebkitMaskImage: mask, maskImage: mask };
};

export const IrisExtra: React.FC<{ progress: number }> = ({ progress }) => {
  const p = ease(progress);
  const baseRadius = interpolate(p, [0, 1], [160, 0]);
  const rotate = interpolate(p, [0, 1], [0, 7]);
  const rings = [10, 20, 32];
  return (
    <AbsoluteFill style={{ transform: `rotate(${rotate}deg)` }}>
      {rings.map((offset, i) => {
        const r = baseRadius + offset;
        const opacity = interpolate(r, [0, 30, 200], [0, 0.35, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: `${r * 2}%`,
              height: `${r * 2}%`,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              border: `2px solid rgba(10,10,12,${opacity})`,
              boxShadow: `0 0 ${18 - i * 4}px rgba(0,0,0,${opacity * 0.6})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------
// 3. Natural Mask / Edge Wipe — a soft directional wipe (bottom to top,
//    like light rising) with a moving glow band tracing the boundary.
// ---------------------------------------------------------------------
export const edgeOutgoingStyle = (rawProgress: number): React.CSSProperties => {
  const p = ease(rawProgress);
  const feather = 15;
  const y = interpolate(p, [0, 1], [100 + feather, -feather]);
  const mask = `linear-gradient(to top, black 0%, black ${Math.max(
    y - feather,
    -50,
  )}%, transparent ${y}%)`;
  return { WebkitMaskImage: mask, maskImage: mask };
};

export const EdgeExtra: React.FC<{ progress: number }> = ({ progress }) => {
  const p = ease(progress);
  const y = interpolate(p, [0, 1], [104, -4]);
  const opacity = interpolate(p, [0, 0.12, 0.85, 1], [0, 0.5, 0.5, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity,
        background: `linear-gradient(to bottom, transparent 0%, rgba(255,225,190,0.9) ${y}%, transparent ${
          y + 16
        }%)`,
        filter: "blur(6px)",
      }}
    />
  );
};

// ---------------------------------------------------------------------
// 4. 2.5D Multiplane Z-Depth Fly-Through — outgoing recedes into the
//    distance, incoming flies toward camera, each wrapped in real
//    per-sample motion blur for smoothness.
// ---------------------------------------------------------------------
export const DepthOutgoingLayer: React.FC<{
  file: string;
  progress: number;
  volume: number;
}> = ({ file, progress, volume }) => {
  const p = Easing.in(Easing.cubic)(progress);
  const scale = interpolate(p, [0, 1], [1, 0.62]);
  const translateZ = interpolate(p, [0, 1], [0, -520]);
  const opacity = interpolate(p, [0, 0.6, 1], [1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ perspective: 1400 }}>
      <CameraMotionBlur shutterAngle={140} samples={6}>
        <AbsoluteFill
          style={{
            transformStyle: "preserve-3d",
            transform: `translateZ(${translateZ}px) scale(${scale})`,
            opacity,
          }}
        >
          <Video file={file} volume={volume} />
        </AbsoluteFill>
      </CameraMotionBlur>
    </AbsoluteFill>
  );
};

export const DepthIncomingLayer: React.FC<{
  file: string;
  progress: number;
  volume: number;
}> = ({ file, progress, volume }) => {
  const p = Easing.out(Easing.cubic)(progress);
  const scale = interpolate(p, [0, 1], [0.55, 1]);
  const translateZ = interpolate(p, [0, 1], [-650, 0]);
  const opacity = interpolate(p, [0, 0.35, 1], [0.15, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ perspective: 1400 }}>
      <CameraMotionBlur shutterAngle={140} samples={6}>
        <AbsoluteFill
          style={{
            transformStyle: "preserve-3d",
            transform: `translateZ(${translateZ}px) scale(${scale})`,
            opacity,
          }}
        >
          <Video file={file} volume={volume} />
        </AbsoluteFill>
      </CameraMotionBlur>
    </AbsoluteFill>
  );
};

export const DepthExtra: React.FC<{ progress: number }> = ({ progress }) => {
  const opacity = interpolate(
    progress,
    [0, 0.35, 0.55, 0.75, 1],
    [0, 0.05, 0.45, 0.1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity,
        background:
          "radial-gradient(circle at 50% 55%, rgba(220,40,30,0.9) 0%, rgba(120,10,10,0.35) 35%, transparent 70%)",
      }}
    />
  );
};
