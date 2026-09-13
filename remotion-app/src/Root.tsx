import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";
import { Shot08Iris } from "./Shot08Iris";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      {/* 24fps is a house choice for this shot (Remotion's own examples default to 30fps) */}
      <Composition
        id="Shot08Iris"
        component={Shot08Iris}
        fps={24}
        width={1920}
        height={1080}
        durationInFrames={77}
      />
    </>
  );
};
