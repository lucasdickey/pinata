// The demo video in Remotion Studio and the CLI (`npm run walkthrough`, then
// pick PinataDemo), where the landing's stylesheet is absent: the same Inter
// file and the theme's tokens, loaded before the first frame is drawn. The
// site never imports this file; it plays PinataDemo inside its own styles.

import { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";
import { PinataDemo, type PinataDemoProps } from "./PinataDemo";

const TOKENS = {
  light: "--bg:#fcfcf9;--surface:#ffffff;--ink:#141414;--ink-soft:#666666;--line-strong:#cfcec8;--accent:#c9381a;",
  dark: "--bg:#181818;--surface:#1f1f1e;--ink:#efefe4;--ink-soft:#a8a8a2;--line-strong:#464641;--accent:#ff6b47;",
};

export function PinataDemoInStudio({ theme }: PinataDemoProps) {
  const [handle] = useState(() => delayRender("Loading Inter"));
  useEffect(() => {
    void document.fonts.load('400 16px "Inter"').finally(() => continueRender(handle));
  }, [handle]);
  const css = `@font-face{font-family:"Inter";src:url(${staticFile("fonts/inter-latin-wght-normal.woff2")}) format("woff2");font-weight:100 900;font-style:normal}:root{${TOKENS[theme]}--font-sans:"Inter",ui-sans-serif,system-ui,sans-serif;--font-mono:ui-monospace,"SFMono-Regular",Menlo,monospace}`;
  return (
    <>
      <style>{css}</style>
      <PinataDemo theme={theme} />
    </>
  );
}
