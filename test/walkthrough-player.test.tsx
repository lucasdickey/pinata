// @vitest-environment jsdom
// The /walkthrough page shell around the Remotion player (D072). The Player
// itself is replaced by a stub that records the methods the page calls, so
// this suite proves the page's own contract: one chapter button per slide in
// order, the current chapter tracked from the player's frame updates, chapter
// clicks and Previous/Next seeking to the slide's first frame and playing,
// arrow keys doing the same, and the transcript following the chapter.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SLIDES, TOTAL_FRAMES, slideStartFrame } from "../remotion/walkthrough/slides";

type FrameListener = (event: { detail: { frame: number } }) => void;

const player = {
  seekTo: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  listeners: new Set<FrameListener>(),
  props: {} as Record<string, unknown>,
  emitFrame(frame: number) {
    act(() => {
      for (const listener of this.listeners) listener({ detail: { frame } });
    });
  },
};

vi.mock("@remotion/player", () => ({
  Player: forwardRef(function PlayerStub(props: Record<string, unknown>, ref) {
    player.props = props;
    useImperativeHandle(ref, () => ({
      seekTo: player.seekTo,
      play: player.play,
      pause: player.pause,
      addEventListener: (name: string, fn: FrameListener) => {
        if (name === "frameupdate") player.listeners.add(fn);
      },
      removeEventListener: (name: string, fn: FrameListener) => {
        if (name === "frameupdate") player.listeners.delete(fn);
      },
    }));
    return <div data-testid="player-stub" />;
  }),
}));

// The composition pulls in remotion's runtime; the page only passes it
// through to the Player, so a stand-in keeps this suite about the page.
vi.mock("../remotion/walkthrough/Walkthrough", () => ({
  Walkthrough: () => null,
}));

import { WalkthroughPlayer } from "../src/components/walkthrough-player";

afterEach(() => {
  cleanup();
  player.seekTo.mockClear();
  player.play.mockClear();
  player.listeners.clear();
});

const chapterButtons = () =>
  within(screen.getByRole("navigation", { name: "Walkthrough chapters" })).getAllByRole("button");

describe("the walkthrough page", () => {
  test("mounts the player with the composition's full length and lists every chapter", () => {
    render(<WalkthroughPlayer />);
    expect(screen.getByRole("heading", { level: 1, name: "How pinata works" })).toBeInTheDocument();
    expect(screen.getByTestId("player-stub")).toBeInTheDocument();
    expect(player.props.durationInFrames).toBe(TOTAL_FRAMES);
    expect(player.props.controls).toBe(true);

    const buttons = chapterButtons();
    expect(buttons).toHaveLength(SLIDES.length);
    buttons.forEach((button, i) => {
      expect(button).toHaveTextContent(SLIDES[i]!.chapter);
    });
    expect(buttons[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("heading", { level: 2, name: SLIDES[0]!.title })).toBeInTheDocument();
    expect(screen.getByText(SLIDES[0]!.notes)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  test("a chapter click seeks to that slide's first frame, plays, and moves the transcript", () => {
    render(<WalkthroughPlayer />);
    fireEvent.click(chapterButtons()[3]!);
    expect(player.seekTo).toHaveBeenCalledWith(slideStartFrame(3));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(chapterButtons()[3]).toHaveAttribute("aria-current", "step");
    expect(chapterButtons()[0]).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 2, name: SLIDES[3]!.title })).toBeInTheDocument();
    expect(screen.getByText(SLIDES[3]!.notes)).toBeInTheDocument();
    expect(screen.getByText(`Chapter 4 of ${SLIDES.length}: ${SLIDES[3]!.chapter}`)).toBeInTheDocument();
  });

  test("the current chapter follows the player's frame updates", () => {
    render(<WalkthroughPlayer />);
    expect(player.listeners.size).toBe(1);
    player.emitFrame(slideStartFrame(6) + 10);
    expect(chapterButtons()[6]).toHaveAttribute("aria-current", "step");
    player.emitFrame(TOTAL_FRAMES - 1);
    expect(chapterButtons()[SLIDES.length - 1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    // A frame update alone never issues a seek.
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  test("Previous, Next, and the arrow keys step one chapter at a time, clamped", () => {
    render(<WalkthroughPlayer />);
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);
    expect(player.seekTo).toHaveBeenLastCalledWith(slideStartFrame(1));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(player.seekTo).toHaveBeenLastCalledWith(slideStartFrame(0));

    const section = screen.getByRole("region", { name: "How pinata works" });
    fireEvent.keyDown(section, { key: "ArrowLeft" });
    expect(chapterButtons()[0]).toHaveAttribute("aria-current", "step");
    fireEvent.keyDown(section, { key: "ArrowRight" });
    fireEvent.keyDown(section, { key: "ArrowRight" });
    expect(chapterButtons()[2]).toHaveAttribute("aria-current", "step");
    expect(player.seekTo).toHaveBeenLastCalledWith(slideStartFrame(2));
  });
});
