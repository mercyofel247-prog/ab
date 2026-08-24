import "./index.css";
import { MyComposition } from "./Composition";
import { TarotCardFlipComposition } from "./transitions/TarotCardFlip";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <TarotCardFlipComposition />
    </>
  );
};
