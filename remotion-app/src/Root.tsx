import "./index.css";
import { MyComposition } from "./Composition";
import { MergedScenesComposition } from "./scenes/MergedScenes";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <MergedScenesComposition />
    </>
  );
};
