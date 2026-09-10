// @vitest-environment jsdom
// The anonymous-to-editor draft handoff (VAL-LANDING-003): an anonymous entry
// is parked in sessionStorage, consumed exactly once by the editor's project
// form after sign-in, and a malformed or mistyped entry is discarded rather
// than trusted. No network is involved in either direction.
import { beforeEach, describe, expect, test } from "vitest";
import {
  CAPTURE_DRAFT_STORAGE_KEY,
  saveCaptureDraft,
  takeCaptureDraft,
} from "../src/lib/capture-draft";

beforeEach(() => {
  sessionStorage.clear();
});

describe("capture draft handoff", () => {
  test("round-trips a draft exactly once", () => {
    saveCaptureDraft({
      rootUrl: "https://chickpea.co/",
      urls: ["https://chickpea.co/pricing", "https://chickpea.co/about"],
    });
    expect(takeCaptureDraft()).toEqual({
      rootUrl: "https://chickpea.co/",
      urls: ["https://chickpea.co/pricing", "https://chickpea.co/about"],
    });
    // Consumed: a later mount (or a StrictMode remount) must not resurrect it.
    expect(takeCaptureDraft()).toBeNull();
    expect(sessionStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY)).toBeNull();
  });

  test("returns null when nothing was saved", () => {
    expect(takeCaptureDraft()).toBeNull();
  });

  test("a malformed or mistyped entry is discarded, never thrown", () => {
    sessionStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, "not json");
    expect(takeCaptureDraft()).toBeNull();
    expect(sessionStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY)).toBeNull();

    sessionStorage.setItem(
      CAPTURE_DRAFT_STORAGE_KEY,
      JSON.stringify({ rootUrl: 42, urls: [] }),
    );
    expect(takeCaptureDraft()).toBeNull();

    sessionStorage.setItem(
      CAPTURE_DRAFT_STORAGE_KEY,
      JSON.stringify({ rootUrl: "https://a.example/", urls: ["ok", 7] }),
    );
    expect(takeCaptureDraft()).toBeNull();

    sessionStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, JSON.stringify(null));
    expect(takeCaptureDraft()).toBeNull();
  });
});
