import { CameraMotionBlur } from "@remotion/motion-blur";
import { ThreeCanvas } from "@remotion/three";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  Composition,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Props = {};

const calculateMetadata: CalculateMetadataFunction<Props> = () => {
  return {};
};

export const MyComposition = () => {
  return (
    <Composition
      id="MyComp"
      component={MyComponent}
      durationInFrames={90}
      fps={30}
      width={1280}
      height={720}
      calculateMetadata={calculateMetadata}
    />
  );
};

// Reads the frame itself so that <Freeze> (used internally by
// CameraMotionBlur to render each blur sample) can re-evaluate its
// position per sample instead of receiving an already-computed value.
const MovingBox: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, durationInFrames } = useVideoConfig();

  const x = interpolate(frame, [0, durationInFrames], [-100, width + 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 580,
        left: x,
        width: 200,
        height: 200,
        borderRadius: 24,
        backgroundColor: "#4fc3f7",
      }}
    />
  );
};

// GSAP timelines run on their own real-time ticker by default, which is
// not frame-accurate for rendering. Building the timeline once (paused)
// and seeking it to `frame / fps` on every render makes it deterministic.
const GsapTitle: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  useLayoutEffect(() => {
    if (!ref.current) {
      return;
    }
    if (!timeline.current) {
      timeline.current = gsap.timeline({ paused: true });
      timeline.current.fromTo(
        ref.current,
        { opacity: 0, y: 40, scale: 0.7 },
        { opacity: 1, y: 0, scale: 1, duration: 1, ease: "back.out(2)" },
      );
    }
    timeline.current.seek(frame / fps);
  }, [frame, fps]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: 60,
        width: "100%",
        textAlign: "center",
        fontFamily: "sans-serif",
        fontSize: 56,
        fontWeight: 700,
        color: "white",
      }}
    >
      Remotion + GSAP + Three.js
    </div>
  );
};

// R3F's own useFrame ticker is real-time, not tied to Remotion's frame
// count, so rotation is driven directly from useCurrentFrame() instead —
// the documented approach for deterministic <ThreeCanvas /> scenes.
const RotatingCube: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <mesh rotation={[frame / 30, frame / 20, 0]}>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#4fc3f7" />
    </mesh>
  );
};

export const MyComponent: React.FC<Props> = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <GsapTitle />
      <ThreeCanvas
        width={400}
        height={400}
        style={{ position: "absolute", top: 160, left: 440 }}
      >
        <ambientLight intensity={1} />
        <pointLight position={[10, 10, 10]} />
        <RotatingCube />
      </ThreeCanvas>
      {/* Each sample re-renders the wrapped subtree once, so render cost for
          this layer scales linearly with `samples`. 4 samples reads as smooth
          motion blur at 30fps while costing ~2.5x less than 10. */}
      <CameraMotionBlur shutterAngle={180} samples={4}>
        <MovingBox />
      </CameraMotionBlur>
    </AbsoluteFill>
  );
};
