import { Composition } from "remotion";
import { Walkthrough } from "./walkthrough/Walkthrough";
import { COMPOSITION_ID, FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./walkthrough/slides";

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Walkthrough}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
}
