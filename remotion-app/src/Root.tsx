import "./index.css";
import { MyComposition } from "./Composition";
import { MergeComposition } from "./MergeVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MergeComposition />
      <MyComposition />
    </>
  );
};
