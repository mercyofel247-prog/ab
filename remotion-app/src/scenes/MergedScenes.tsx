import React from "react";
import { AbsoluteFill, Composition, Sequence, interpolate, useCurrentFrame } from "remotion";
import {
  clips,
  cuts,
  CutConfig,
  FPS,
  HEIGHT,
  totalDurationInFrames,
  WIDTH,
} from "./scenesConfig";
import {
  DepthExtra,
  DepthIncomingLayer,
  DepthOutgoingLayer,
  EdgeExtra,
  IrisExtra,
  LiquidExtra,
  Video,
  edgeOutgoingStyle,
  irisOutgoingStyle,
  liquidIncomingStyle,
  liquidOutgoingStyle,
} from "./transitions";

const clampProgress = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const ClipLayer: React.FC<{
  index: number;
}> = ({ index }) => {
  const clip = clips[index];
  const incomingCut = cuts.find((c) => c.inIdx === index);
  const outgoingCut = cuts.find((c) => c.outIdx === index);
  const localFrame = useCurrentFrame();
  const globalFrame = localFrame + clip.start;

  const progressIn = incomingCut
    ? clampProgress(globalFrame, incomingCut.overlapStart, incomingCut.overlapEnd)
    : 1;
  const progressOut = outgoingCut
    ? clampProgress(globalFrame, outgoingCut.overlapStart, outgoingCut.overlapEnd)
    : 0;

  let phase: "incoming" | "outgoing" | "plain" = "plain";
  let cut: CutConfig | undefined;
  if (incomingCut && progressIn < 1) {
    phase = "incoming";
    cut = incomingCut;
  } else if (outgoingCut && progressOut > 0) {
    phase = "outgoing";
    cut = outgoingCut;
  }

  const zIndex =
    phase === "plain" || !cut
      ? 0
      : cut.outgoingOnTop
        ? phase === "outgoing"
          ? 2
          : 1
        : phase === "outgoing"
          ? 1
          : 2;

  // Audio crossfades in step with the visual transition: ramping the
  // outgoing clip's volume down and the incoming clip's volume up avoids
  // the abrupt double-audio overlap Remotion's default Sequence mixing
  // would otherwise produce during the shared window.
  const volume =
    phase === "incoming" ? progressIn : phase === "outgoing" ? 1 - progressOut : 1;

  let content: React.ReactNode;
  if (phase === "plain" || !cut) {
    content = <Video file={clip.file} />;
  } else if (cut.type === "liquid") {
    content = (
      <Video
        file={clip.file}
        volume={volume}
        style={
          phase === "incoming"
            ? liquidIncomingStyle(progressIn)
            : liquidOutgoingStyle(progressOut)
        }
      />
    );
  } else if (cut.type === "iris") {
    content =
      phase === "incoming" ? (
        <Video file={clip.file} volume={volume} />
      ) : (
        <Video file={clip.file} volume={volume} style={irisOutgoingStyle(progressOut)} />
      );
  } else if (cut.type === "edge") {
    content =
      phase === "incoming" ? (
        <Video file={clip.file} volume={volume} />
      ) : (
        <Video file={clip.file} volume={volume} style={edgeOutgoingStyle(progressOut)} />
      );
  } else {
    // depth
    content =
      phase === "incoming" ? (
        <DepthIncomingLayer file={clip.file} progress={progressIn} volume={volume} />
      ) : (
        <DepthOutgoingLayer file={clip.file} progress={progressOut} volume={volume} />
      );
  }

  return <AbsoluteFill style={{ zIndex }}>{content}</AbsoluteFill>;
};

const CutExtra: React.FC<{ cut: CutConfig }> = ({ cut }) => {
  const localFrame = useCurrentFrame();
  const progress = clampProgress(
    localFrame + cut.overlapStart,
    cut.overlapStart,
    cut.overlapEnd,
  );
  return (
    <AbsoluteFill style={{ zIndex: 100 }}>
      {cut.type === "liquid" && <LiquidExtra progress={progress} />}
      {cut.type === "iris" && <IrisExtra progress={progress} />}
      {cut.type === "edge" && <EdgeExtra progress={progress} />}
      {cut.type === "depth" && <DepthExtra progress={progress} />}
    </AbsoluteFill>
  );
};

export const MergedScenesComponent: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {clips.map((clip, index) => (
        <Sequence
          key={clip.name}
          from={clip.start}
          durationInFrames={clip.duration}
          layout="none"
        >
          <ClipLayer index={index} />
        </Sequence>
      ))}
      {cuts.map((cut) => (
        <Sequence
          key={`${cut.outIdx}-${cut.inIdx}`}
          from={cut.overlapStart}
          durationInFrames={cut.overlapEnd - cut.overlapStart}
          layout="none"
        >
          <CutExtra cut={cut} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const MergedScenesComposition = () => (
  <Composition
    id="MergedScenes"
    component={MergedScenesComponent}
    durationInFrames={totalDurationInFrames}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
