import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import { Ch1_06 } from "./Ch1_06";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <Composition
        id="Ch1-06"
        component={Ch1_06}
        durationInFrames={72}
        fps={24}
        width={1920}
        height={1080}
      />
    </>
  );
};
