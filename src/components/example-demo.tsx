"use client";

// The landing example as a demo video (D127). The server renders the static
// example (its children) so the page is complete without script and for
// visitors who ask for reduced motion; once mounted, if motion is fine, it
// swaps in the Remotion player looping PinataDemo, muted, with controls so it
// can be paused. Nothing is fetched: the video is drawn in the browser from
// the same fixture as the static example and the table below it.

import { Player } from "@remotion/player";
import { useEffect, useState, type ReactNode } from "react";
import {
  DEMO_FPS,
  DEMO_FRAMES,
  DEMO_HEIGHT,
  DEMO_WIDTH,
  PinataDemo,
} from "../../remotion/demo/PinataDemo";

export function ExampleDemo({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  if (!motion) return <>{children}</>;

  return (
    <div
      className="example-demo"
      data-testid="example-demo"
      // A group, not an image: the player's play and pause controls live
      // inside it, and an image may not contain controls.
      role="group"
      aria-label={label}
    >
      <Player
        component={PinataDemo}
        durationInFrames={DEMO_FRAMES}
        fps={DEMO_FPS}
        compositionWidth={DEMO_WIDTH}
        compositionHeight={DEMO_HEIGHT}
        autoPlay
        loop
        controls
        clickToPlay
        showVolumeControls={false}
        acknowledgeRemotionLicense
        style={{ width: "100%" }}
      />
    </div>
  );
}
