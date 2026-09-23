// @vitest-environment jsdom
// Thread times read like a person wrote them (D097): "Sep 23, 5:04 PM" in the
// reader's locale and zone, the year only when it is not this year, and the
// exact instant kept on <time dateTime> and its title. Locale, zone, and now
// are pinned here so the expectations hold on any machine.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ThreadView, formatThreadTime } from "../src/components/thread-view";

afterEach(() => cleanup());

// 2026-09-24T00:04:00Z is 5:04 PM on Sep 23 in Los Angeles (PDT).
const EVENING = Date.UTC(2026, 8, 24, 0, 4);
const NOW = Date.UTC(2026, 8, 24, 12, 0);
const pinned = { locale: "en-US", timeZone: "America/Los_Angeles", now: NOW };
/** Intl may use a narrow no-break space before AM/PM; compare as plain spaces. */
const plain = (text: string) => text.replace(/\s/g, " ");

describe("formatThreadTime", () => {
  test("reads as month, day, and local time, with no UTC suffix or seconds", () => {
    expect(plain(formatThreadTime(EVENING, pinned))).toBe("Sep 23, 5:04 PM");
  });

  test("uses the reader's zone, not UTC", () => {
    expect(plain(formatThreadTime(EVENING, { ...pinned, timeZone: "UTC" }))).toBe(
      "Sep 24, 12:04 AM",
    );
  });

  test("names the year only when it is not the current one", () => {
    const lastYear = Date.UTC(2025, 11, 31, 20, 0);
    expect(plain(formatThreadTime(lastYear, pinned))).toBe("Dec 31, 2025, 12:00 PM");
  });

  test("follows the reader's locale", () => {
    // Day first and a 24-hour clock; ICU versions differ on "Sep" or "Sept".
    expect(plain(formatThreadTime(EVENING, { ...pinned, locale: "en-GB" }))).toMatch(
      /^23 Sept?, 17:04$/,
    );
  });
});

describe("ThreadView times", () => {
  test("each entry carries a friendly time with the exact instant in dateTime and title", () => {
    render(
      <ThreadView
        originalBody="The headline wraps."
        status="ready"
        entries={[
          {
            id: "thr-1",
            annotationId: "ann-1",
            actorRole: "founder",
            authorLabel: "founder",
            kind: "message",
            body: "Fixed.",
            createdAt: EVENING,
          },
          {
            id: "thr-2",
            annotationId: "ann-1",
            actorRole: "founder",
            authorLabel: "founder",
            kind: "status",
            body: "Resolved by founder",
            createdAt: EVENING,
          },
        ]}
        replyBody=""
        onReplyBodyChange={() => {}}
        onSendReply={() => {}}
        sendState="idle"
        composerLabel="Reply as founder"
        sendLabel="Send reply"
      />,
    );
    const thread = screen.getByTestId("thread");
    const times = thread.querySelectorAll("time");
    expect(times).toHaveLength(2);
    for (const time of times) {
      expect(time).toHaveAttribute("dateTime", "2026-09-24T00:04:00.000Z");
      expect(time).toHaveAttribute("title", "2026-09-24T00:04:00.000Z");
      // The runtime's own locale and zone, whatever they are here.
      expect(time.textContent).toBe(formatThreadTime(EVENING));
      expect(time.textContent).not.toContain("UTC");
    }
    expect(within(thread).getByText(/Resolved by founder/)).toBeInTheDocument();
  });
});
