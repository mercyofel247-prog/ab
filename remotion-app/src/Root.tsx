import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import {
  StageDepthParallax,
  stageDepthParallaxDefaultProps,
} from "./StageDepthParallax";
import {
  BeatSyncVisualizer,
  beatSyncDefaultProps,
} from "./BeatSyncVisualizer";
import manifest from "../public/audio/beat-manifest.json";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <Composition
        id="StageDepthParallax"
        component={StageDepthParallax}
        durationInFrames={120}
        fps={24}
        width={3840}
        height={2160}
        defaultProps={stageDepthParallaxDefaultProps}
      />
      <Composition
        id="BeatSyncVisualizer"
        component={BeatSyncVisualizer}
        durationInFrames={manifest.durationInFrames}
        fps={manifest.fps}
        width={1920}
        height={1080}
        defaultProps={beatSyncDefaultProps}
      />
    </>
  );
};
