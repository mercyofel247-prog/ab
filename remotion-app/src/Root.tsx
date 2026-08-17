import "./index.css";
import { MyComposition } from "./Composition";
import { MetalNumeralComposition } from "./MetalNumeral";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <MetalNumeralComposition />
    </>
  );
};
