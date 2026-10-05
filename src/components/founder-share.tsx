"use client";

// The editor's per-project "Share with founder" control (REQUIREMENTS 7).
//
// It sits in the selected project's header (D075) and reads the capability
// status once on mount so the current state — no link, active with its
// version, or revoked — is visible next to the toggle without opening the
// panel. Open, the panel offers Create or Rotate plus Revoke. Issuing shows
// the complete link exactly once — the server persists only a digest and
// can never show the token again — with the token in the URL fragment so it
// never reaches a server log or referrer.
//
// Rotate and Revoke each end the link the founder already has, so each asks
// once, inline, before doing it (D097): the button becomes a sentence that
// says what will happen plus Confirm and Cancel. Create has nothing to break
// and goes straight through.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import type {
  FounderShareIssueResponse,
  FounderShareStatusResponse,
  FounderShareView,
} from "../lib/threads";
import { CanvasIcon } from "./canvas-icons";

type StatusState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; share: FounderShareView }
  | { status: "failed" };

/** The complete founder link for one issue response, fragment and all. */
export function composeFounderLink(origin: string, path: string, token: string): string {
  return `${origin}${path}#${token}`;
}

export function FounderShareControl({
  publicId,
  projectTitle,
}: {
  publicId: string;
  projectTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<StatusState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The one-time link: held only in component state, shown until the
  // control is closed or the capability changes again.
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Which destructive action is waiting for its confirmation, if any.
  const [confirming, setConfirming] = useState<"rotate" | "revoke" | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const actionButtons = useRef<HTMLParagraphElement | null>(null);
  // Focus follows the step: into Confirm when it appears, and back to the
  // action row when the step closes, so a keyboard user never loses place.
  const focusAfter = useRef<"confirm" | "actions" | null>(null);
  const toggleButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focusAfter.current === "confirm") confirmButton.current?.focus();
    else if (focusAfter.current === "actions") {
      actionButtons.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
    focusAfter.current = null;
  }, [confirming]);

  const ask = (action: "rotate" | "revoke") => {
    setError(null);
    focusAfter.current = "confirm";
    setConfirming(action);
  };
  const cancelConfirm = () => {
    focusAfter.current = "actions";
    setConfirming(null);
  };

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(publicId)}/share`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setState({ status: "failed" });
        return;
      }
      const payload = (await response.json()) as Partial<FounderShareStatusResponse>;
      if (!payload.share || typeof payload.share.state !== "string") {
        setState({ status: "failed" });
        return;
      }
      setState({ status: "ready", share: payload.share });
    } catch {
      setState({ status: "failed" });
    }
  }, [publicId]);

  // The status is read once on mount so the inline state is always shown;
  // opening the panel re-reads only when that first read failed.
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setError(null);
    setConfirming(null);
    if (next) {
      if (state.status === "failed") void load();
    } else {
      // Closing forgets the one-time link; the server cannot re-show it.
      setFreshLink(null);
      setCopied(false);
    }
  };

  const issue = async () => {
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(publicId)}/share`, {
        method: "POST",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
      if (!response.ok) {
        setError("The founder link could not be created. Try again.");
        return;
      }
      const payload = (await response.json()) as FounderShareIssueResponse;
      setState({ status: "ready", share: payload.share });
      setFreshLink(composeFounderLink(window.location.origin, payload.path, payload.token));
    } catch {
      setError("The founder link could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(publicId)}/share`, {
        method: "DELETE",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
      if (!response.ok) {
        setError("The founder link could not be revoked. Try again.");
        return;
      }
      const payload = (await response.json()) as FounderShareStatusResponse;
      setState({ status: "ready", share: payload.share });
      setFreshLink(null);
      setCopied(false);
    } catch {
      setError("The founder link could not be revoked. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const share = state.status === "ready" ? state.share : null;
  // What the link is for, or what state it is in, as the panel's first line.
  const lede =
    share === null
      ? null
      : share.state === "none"
        ? "Send the founder a private link to review the pins and reply. No account needed."
        : share.state === "active"
          ? `Version ${share.version} is live. Rotate to replace it, or revoke to turn it off.`
          : "The link is off, and nobody can open the review. Create a new one to share again."
  // The short form beside the toggle, always visible (D075, D122).
  const chipState =
    share === null
      ? state.status === "failed"
        ? "Unavailable"
        : "Checking…"
      : share.state === "none"
        ? "Off"
        : share.state === "active"
          ? `Active · v${share.version}`
          : "Revoked";
  const close = () => {
    if (open) toggle();
    toggleButton.current?.focus();
  };
  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };

  return (
    <div className="link-control" data-testid="founder-share" data-open={open}>
      <div className="link-chip" data-state={share?.state ?? state.status}>
        <button
          type="button"
          className="link-chip-toggle"
          ref={toggleButton}
          aria-expanded={open}
          aria-controls={`founder-share-${publicId}`}
          onClick={toggle}
        >
          <CanvasIcon name="link" size={16} />
          Share with founder
          <CanvasIcon name="caret-down" size={14} />
        </button>
        <span
          className="link-chip-state"
          data-testid="founder-share-state"
          data-state={share?.state ?? state.status}
        >
          {chipState}
        </span>
      </div>
      {open ? (
        <div
          id={`founder-share-${publicId}`}
          className="link-panel"
          aria-label={`Founder link for ${projectTitle}`}
          role="group"
          onKeyDown={onPanelKeyDown}
        >
          <div className="link-panel-head">
            <p className="link-panel-title">Founder link</p>
            <button type="button" className="link-panel-close" aria-label="Close" onClick={close}>
              <CanvasIcon name="close" size={16} />
            </button>
          </div>
          {state.status === "loading" ? <p className="link-panel-lede">Checking link…</p> : null}
          {state.status === "failed" ? (
            <p className="link-panel-lede">The link status could not be read. Close and reopen to retry.</p>
          ) : null}
          {lede ? <p className="link-panel-lede">{lede}</p> : null}
          {freshLink ? (
            <div className="link-fresh">
              <label className="link-field-label" htmlFor={`founder-share-url-${publicId}`}>
                Founder link (shown once — copy it now)
              </label>
              <div className="link-copy-row">
                <input
                  id={`founder-share-url-${publicId}`}
                  type="text"
                  readOnly
                  value={freshLink}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button type="button" className="button-primary" onClick={() => void copy()}>
                  <CanvasIcon name="copy" size={15} />
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <p className="link-panel-note">
                It is shown once: Pinata keeps only a fingerprint of it. Rotate to issue a new one.
              </p>
            </div>
          ) : null}
          {share && confirming ? (
            <div
              className="link-confirm"
              role="group"
              aria-labelledby={`founder-share-confirm-${publicId}`}
              data-testid="founder-share-confirm"
            >
              <p id={`founder-share-confirm-${publicId}`}>
                {confirming === "rotate"
                  ? "Rotate the link? The link the founder has now stops working, and you get a new one to send."
                  : "Revoke the link? The link the founder has now stops working, and nobody can open the review until you create a new one."}
              </p>
              <p className="link-panel-actions">
                <button
                  type="button"
                  ref={confirmButton}
                  className={confirming === "revoke" ? "link-danger-solid" : "button-primary"}
                  onClick={() => void (confirming === "rotate" ? issue() : revoke())}
                  disabled={busy}
                >
                  {confirming === "rotate" ? "Yes, rotate link" : "Yes, revoke link"}
                </button>
                <button type="button" onClick={cancelConfirm} disabled={busy}>
                  Cancel
                </button>
              </p>
            </div>
          ) : null}
          {share && !confirming ? (
            <p className="link-panel-actions" ref={actionButtons}>
              {share.state === "active" ? (
                <>
                  <button type="button" onClick={() => ask("rotate")} disabled={busy}>
                    Rotate link
                  </button>
                  <button
                    type="button"
                    className="link-danger"
                    onClick={() => ask("revoke")}
                    disabled={busy}
                  >
                    Revoke link
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => void issue()}
                  disabled={busy}
                >
                  Create link
                </button>
              )}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="capture-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
