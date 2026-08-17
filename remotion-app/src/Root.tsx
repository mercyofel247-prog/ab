import "./index.css";
import { Composition } from "remotion";
import { MetalNumeral } from "./MetalNumeral";
import { LOOK } from "./look-block";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MetalNumeral"
      component={MetalNumeral}
      durationInFrames={LOOK.dwellInFrames}
      fps={LOOK.fps}
      width={LOOK.width}
      height={LOOK.height}
      defaultProps={{
        value: "$4.5B",
        label: "PAPER NET WORTH",
      }}
    />
  );
};
