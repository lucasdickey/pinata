"use client";

// The landing's demo video (D140), right under the hero: the real product,
// filmed screen by screen and played by Remotion in the page's own theme
// (remotion/demo/README.md). It plays muted and loops, with the player's own
// pause and seek controls and one button per chapter. Without script, and
// for visitors who ask for reduced motion, it is a still of the real
// workspace with its notes; the video starts only when they press play or
// pick a chapter.

import { Player, type PlayerRef } from "@remotion/player";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEMO_FPS,
  DEMO_FRAMES,
  DEMO_HEIGHT,
  DEMO_WIDTH,
  PinataDemo,
} from "../../remotion/demo/PinataDemo";
import { getShot, lastFilmed, SHOTS, shotSrc } from "../../remotion/demo/shots";
import { CHAPTER_STARTS, CHAPTERS, chapterAt, type ChapterId } from "../../remotion/demo/timeline";
import { currentTheme, type Theme } from "../lib/theme";

/** The still that stands in for the video: every mark placed, the list beside them. */
export const DEMO_POSTER_SHOT = "annotate-done";

const LABEL =
  "A demo of Pinata, filmed in the product: a pricing page is captured, a pin and a circle are added with their comments, the founder gets one link and replies, and the notes are handed to a coding agent.";

/** "October 15, 2026", the same on the server and in every time zone. */
function filmedOn(): string {
  return new Date(lastFilmed()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Follow the page's theme: the saved choice on <html>, else the device. */
function usePageTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const update = () => setTheme(currentTheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener?.("change", update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", update);
    };
  }, []);
  return theme;
}

/** Whether the visitor is fine with motion; unknown (null) until mounted. */
function useMotionAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    // No way to ask (old browsers, test DOMs): keep the still, which plays
    // on request, rather than start motion nobody agreed to.
    if (typeof window.matchMedia !== "function") {
      setAllowed(false);
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAllowed(!query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return allowed;
}

/** The poster in both themes; the stylesheet shows the one the page is in. */
function Poster() {
  const shot = getShot(DEMO_POSTER_SHOT);
  return (
    <>
      <img
        className="demo-poster demo-poster-light"
        src={shotSrc(shot, "light")}
        alt=""
        width={DEMO_WIDTH}
        height={DEMO_HEIGHT}
        decoding="async"
      />
      <img
        className="demo-poster demo-poster-dark"
        src={shotSrc(shot, "dark")}
        alt=""
        width={DEMO_WIDTH}
        height={DEMO_HEIGHT}
        loading="lazy"
        decoding="async"
      />
    </>
  );
}

export function DemoVideo() {
  const motion = useMotionAllowed();
  const theme = usePageTheme();
  const player = useRef<PlayerRef>(null);
  // Playing once the visitor allows motion, or as soon as they ask.
  const [requested, setRequested] = useState<{ chapter: ChapterId } | null>(null);
  const [chapter, setChapter] = useState<ChapterId>(CHAPTERS[0].id);
  const playing = motion === true || requested !== null;

  // Fetch every screen of the current theme ahead of the playhead.
  useEffect(() => {
    if (!playing) return;
    for (const shot of Object.values(SHOTS)) {
      const image = new Image();
      image.src = shotSrc(shot, theme);
    }
  }, [playing, theme]);

  // The player exists once `playing` renders it; follow its chapters and
  // honor a chapter picked before it existed.
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => setChapter(chapterAt(detail.frame));
    current.addEventListener("frameupdate", onFrame);
    if (requested) {
      current.seekTo(CHAPTER_STARTS[requested.chapter]);
      current.play();
    }
    return () => current.removeEventListener("frameupdate", onFrame);
  }, [playing, requested]);

  const pick = useCallback(
    (id: ChapterId) => {
      setChapter(id);
      if (player.current) {
        player.current.seekTo(CHAPTER_STARTS[id]);
        player.current.play();
      } else {
        setRequested({ chapter: id });
      }
    },
    [],
  );

  return (
    <figure className="demo-video">
      <div
        className="demo-video-frame"
        data-testid="demo-video"
        // A group, not an image: the player's play and pause controls live
        // inside it, and an image may not contain controls.
        role="group"
        aria-label={LABEL}
      >
        {playing ? (
          <Player
            ref={player}
            component={PinataDemo}
            inputProps={{ theme }}
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
        ) : (
          <>
            <Poster />
            {motion === false ? (
              <button
                type="button"
                className="demo-play"
                onClick={() => pick(CHAPTERS[0].id)}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                  <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
                </svg>
                Play the demo
              </button>
            ) : null}
          </>
        )}
      </div>
      <ol className="demo-chapters" aria-label="Chapters">
        {CHAPTERS.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              aria-current={playing && chapter === entry.id ? "true" : undefined}
              onClick={() => pick(entry.id)}
            >
              <span className="demo-chapter-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              {entry.label}
            </button>
          </li>
        ))}
      </ol>
      <figcaption className="hint">
        Every frame is the real product, filmed on {filmedOn()}.
      </figcaption>
    </figure>
  );
}
