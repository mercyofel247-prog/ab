import { CameraMotionBlur } from "@remotion/motion-blur";
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
      durationInFrames={60}
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
        top: 260,
        left: x,
        width: 200,
        height: 200,
        borderRadius: 24,
        backgroundColor: "#4fc3f7",
      }}
    />
  );
};

export const MyComponent: React.FC<Props> = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <CameraMotionBlur shutterAngle={180} samples={10}>
        <MovingBox />
      </CameraMotionBlur>
    </AbsoluteFill>
  );
};
