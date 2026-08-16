import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import {
  StageDepthParallax,
  stageDepthParallaxDefaultProps,
} from "./StageDepthParallax";

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
    </>
  );
};
