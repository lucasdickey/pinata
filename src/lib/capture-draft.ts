// The anonymous-to-editor capture draft handoff (VAL-LANDING-003, D067).
//
// An anonymous visitor fills the landing's capture entry; submitting parks
// the draft in sessionStorage and routes to the editor sign-in prompt — no
// request is made, because an anonymous visitor is not authorized to create
// anything. After sign-in the editor is routed to the project form at
// /pins/new (D069), which consumes the draft exactly once.
//
// sessionStorage is the right store: the draft is same-tab (the sign-in
// happens in the tab that submitted), survives the server re-render that
// sign-in triggers, and dies with the tab. This module is client-safe: it
// touches only sessionStorage, validates what it reads, and never throws.

export const CAPTURE_DRAFT_STORAGE_KEY = "pinata:capture-draft";

export interface CaptureDraft {
  rootUrl: string;
  urls: string[];
}

/** Park the anonymous entry for the post-sign-in project form. */
export function saveCaptureDraft(draft: CaptureDraft): void {
  try {
    sessionStorage.setItem(CAPTURE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or unavailable (private modes): the handoff degrades to a
    // blank form, never to a crash.
  }
}

/**
 * Whether a draft is parked, without consuming it. Sign-in needs to know
 * where to send the editor — the form at /pins/new when an anonymous entry
 * is waiting, the workspace otherwise — and answering that question must
 * not destroy the draft the destination is about to read.
 */
export function hasCaptureDraft(): boolean {
  try {
    return sessionStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Read AND remove the parked draft atomically. A malformed or mistyped entry
 * is discarded and removed, so it can never poison a later mount; a
 * StrictMode double-effect or a reload after consumption sees nothing.
 */
export function takeCaptureDraft(): CaptureDraft | null {
  try {
    const raw = sessionStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(CAPTURE_DRAFT_STORAGE_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.rootUrl !== "string") return null;
    if (
      !Array.isArray(candidate.urls) ||
      !candidate.urls.every((url) => typeof url === "string")
    ) {
      return null;
    }
    return { rootUrl: candidate.rootUrl, urls: candidate.urls };
  } catch {
    return null;
  }
}
