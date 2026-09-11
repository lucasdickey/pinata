// Remotion entry point (D072). `npm run walkthrough` opens this in Remotion
// Studio; `npm run walkthrough:render` renders it to an MP4. The Next.js app
// never imports this file — the in-app player at /walkthrough mounts the
// composition component directly through @remotion/player.
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
