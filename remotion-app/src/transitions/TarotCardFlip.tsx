// Transition #20 "3D Portrait / Tarot Card Flip" (manifest.json: engine=remotion,
// render_mode=baked — this composition bridges both source clips itself, so
// ffmpeg just concats it at assembly, no further compositing needed).
//
// Deliberately a CSS 3D transform flip (perspective + rotateY,
// backface-visibility) rather than an R3F/WebGL video-texture plane: mapping
// a frame-accurate <OffthreadVideo> onto a Three.js texture is fragile
// (video elements aren't frame-locked the way Remotion's own video pipeline
// is), while a CSS 3D transform is a real 3D transform, is deterministic
// from `frame` alone, and is GPU-composited by Chromium directly — which is
// exactly what chromiumOptions.hardwareAcceleration accelerates.
import {
  AbsoluteFill,
  Composition,
  Easing,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Props = {
  clipASrc: string;
  clipBSrc: string;
};

export const TarotCardFlipComposition: React.FC = () => {
  return (
    <Composition
      id="TarotCardFlip"
      component={TarotCardFlip}
      durationInFrames={30}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ clipASrc: "", clipBSrc: "" } satisfies Props}
    />
  );
};

export const TarotCardFlip: React.FC<Props> = ({ clipASrc, clipBSrc }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();

  const rotateY = interpolate(frame, [0, durationInFrames - 1], [0, 180], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <div
        style={{
          width,
          height,
          perspective: 2400,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            transformStyle: "preserve-3d",
            transform: `rotateY(${rotateY}deg)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
            }}
          >
            {clipASrc ? (
              <OffthreadVideo src={clipASrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : null}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            {clipBSrc ? (
              <OffthreadVideo src={clipBSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : null}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
