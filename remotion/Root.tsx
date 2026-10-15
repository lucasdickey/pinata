import { Composition } from "remotion";
import { DEMO_FPS, DEMO_FRAMES, DEMO_HEIGHT, DEMO_WIDTH } from "./demo/PinataDemo";
import { PinataDemoInStudio } from "./demo/Studio";
import { Walkthrough } from "./walkthrough/Walkthrough";
import { COMPOSITION_ID, FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./walkthrough/slides";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id={COMPOSITION_ID}
        component={Walkthrough}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {/* The landing's demo video (D140); props pick the theme. */}
      <Composition
        id="PinataDemo"
        component={PinataDemoInStudio}
        durationInFrames={DEMO_FRAMES}
        fps={DEMO_FPS}
        width={DEMO_WIDTH}
        height={DEMO_HEIGHT}
        defaultProps={{ theme: "light" as const }}
      />
    </>
  );
}
