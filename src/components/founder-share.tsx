"use client";

// The editor's per-project "Share with founder" control (REQUIREMENTS 7).
//
// Closed by default and reading nothing until opened, so the workspace's
// default traffic is unchanged. Open, it reads the capability status (no
// link / active / revoked, with the version), and offers Create or Rotate
// plus Revoke. Issuing shows the complete link exactly once — the server
// persists only a digest and can never show the token again — with the
// token in the URL fragment so it never reaches a server log or referrer.

import { useCallback, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import type {
  FounderShareIssueResponse,
  FounderShareStatusResponse,
  FounderShareView,
} from "../lib/threads";

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
      const payload = (await response.json()) as FounderShareStatusResponse;
      setState({ status: "ready", share: payload.share });
    } catch {
      setState({ status: "failed" });
    }
  }, [publicId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setError(null);
    if (next) {
      void load();
    } else {
      // Closing forgets the one-time link; the server cannot re-show it.
      setFreshLink(null);
      setCopied(false);
    }
  };

  const issue = async () => {
    if (busy) return;
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
  const summary =
    share === null
      ? null
      : share.state === "none"
        ? "No founder link yet."
        : share.state === "active"
          ? `Founder link active (version ${share.version}).`
          : `Founder link revoked (was version ${share.version}).`;

  return (
    <div className="founder-share" data-testid="founder-share">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`founder-share-${publicId}`}
        onClick={toggle}
      >
        Share with founder
      </button>
      {open ? (
        <div
          id={`founder-share-${publicId}`}
          className="founder-share-panel"
          aria-label={`Founder link for ${projectTitle}`}
          role="group"
        >
          {state.status === "loading" ? <p className="panel-note">Checking link…</p> : null}
          {state.status === "failed" ? (
            <p className="panel-note">The link status could not be read. Close and reopen to retry.</p>
          ) : null}
          {summary ? <p className="founder-share-status">{summary}</p> : null}
          {freshLink ? (
            <div className="founder-share-fresh">
              <label className="panel-field">
                Founder link (shown once — copy it now)
                <input
                  type="text"
                  readOnly
                  value={freshLink}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <p className="panel-actions">
                <button type="button" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy link"}
                </button>
              </p>
              <p className="panel-note">
                Pinata stores only a fingerprint of this link, so it cannot be shown again.
                Rotate to issue a new one.
              </p>
            </div>
          ) : null}
          {share ? (
            <p className="panel-actions">
              <button type="button" onClick={() => void issue()} disabled={busy}>
                {share.state === "active" ? "Rotate link" : "Create link"}
              </button>
              {share.state === "active" ? (
                <button type="button" onClick={() => void revoke()} disabled={busy}>
                  Revoke link
                </button>
              ) : null}
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
