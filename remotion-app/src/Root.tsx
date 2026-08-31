import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import { Ch1_06 } from "./Ch1_06";
import { ImposeVerdict, IMPOSE_VERDICT_DURATION_FRAMES } from "./ImposeVerdict";

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
      <Composition
        id="Impose800B"
        component={ImposeVerdict}
        durationInFrames={IMPOSE_VERDICT_DURATION_FRAMES}
        fps={24}
        width={1920}
        height={1080}
      />
    </>
  );
};
