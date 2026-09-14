"use client";

// The in-browser walkthrough (D072). @remotion/player mounts the same
// composition Remotion Studio and the MP4 render use, so there is one source
// for the video. Around it: a chapter list that seeks the player to a slide,
// previous/next controls, arrow-key navigation while focus is inside the
// section, and the transcript for whichever chapter is on screen.
import { Player, type PlayerRef } from "@remotion/player";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  FPS,
  HEIGHT,
  SLIDES,
  TOTAL_FRAMES,
  WIDTH,
  formatDuration,
  slideIndexAtFrame,
  slideStartFrame,
} from "../../remotion/walkthrough/slides";
import { Walkthrough } from "../../remotion/walkthrough/Walkthrough";

export function WalkthroughPlayer() {
  const playerRef = useRef<PlayerRef>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => {
      setCurrent(slideIndexAtFrame(event.detail.frame));
    };
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, []);

  const goTo = useCallback((index: number) => {
    const clamped = Math.min(Math.max(index, 0), SLIDES.length - 1);
    const player = playerRef.current;
    setCurrent(clamped);
    if (!player) return;
    player.seekTo(slideStartFrame(clamped));
    player.play();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      goTo(current + 1);
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      goTo(current - 1);
    }
  };

  const slide = SLIDES[current]!;

  return (
    <section className="walkthrough" aria-labelledby="walkthrough-title" onKeyDown={onKeyDown}>
      <h1 id="walkthrough-title">How pinata works</h1>
      <p className="walkthrough-lede">
        Ten chapters, {formatDuration(TOTAL_FRAMES)} end to end. Press play, or pick a chapter.
        Space plays and pauses; the arrow keys move between chapters while the walkthrough has
        focus.
      </p>

      <div className="walkthrough-stage" data-testid="walkthrough-stage">
        <Player
          ref={playerRef}
          component={Walkthrough}
          durationInFrames={TOTAL_FRAMES}
          fps={FPS}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          controls
          clickToPlay
          doubleClickToFullscreen
          spaceKeyToPlayOrPause
          showVolumeControls={false}
          acknowledgeRemotionLicense
          style={{ width: "100%" }}
        />
      </div>

      <div className="walkthrough-controls">
        <button type="button" onClick={() => goTo(current - 1)} disabled={current === 0}>
          Previous
        </button>
        <p className="walkthrough-position" aria-live="polite">
          Chapter {current + 1} of {SLIDES.length}: {slide.chapter}
        </p>
        <button
          type="button"
          onClick={() => goTo(current + 1)}
          disabled={current === SLIDES.length - 1}
        >
          Next
        </button>
      </div>

      <div className="walkthrough-body">
        <nav className="walkthrough-chapters" aria-label="Walkthrough chapters">
          <ol>
            {SLIDES.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={i === current ? "step" : undefined}
                >
                  <span className="walkthrough-chapter-number">{i + 1}</span>
                  <span className="walkthrough-chapter-label">{s.chapter}</span>
                  <span className="walkthrough-chapter-time">
                    {formatDuration(slideStartFrame(i))}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <article className="walkthrough-notes" aria-label="Chapter transcript">
          <h2>{slide.title}</h2>
          <p>{slide.notes}</p>
        </article>
      </div>
    </section>
  );
}
