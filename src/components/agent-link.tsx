"use client";

// The editor's per-project "Agent link" control (D121), beside "Share with
// founder" in the project header and built the same way.
//
// The agent link is a secret URL that serves a read-only Markdown brief of
// the project's open marks, with links to each screenshot, so a coding agent
// can be pointed at it instead of being handed a Markdown paste and images
// one by one. Creating it shows the link once — the server keeps only a
// fingerprint — together with a one-line prompt that can be pasted into an
// agent as is. Rotate and Revoke each end the link already handed out, so
// each asks once, inline, before doing it (D097).

import { useCallback, useEffect, useRef, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import {
  agentPrompt,
  type AgentLinkIssueResponse,
  type AgentLinkStatusResponse,
  type AgentLinkView,
} from "../lib/agent-link";

type StatusState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; link: AgentLinkView }
  | { status: "failed" };

export function AgentLinkControl({
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
  // The one-time link, held only in component state until the control closes.
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "prompt" | null>(null);
  const [confirming, setConfirming] = useState<"rotate" | "revoke" | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const actionButtons = useRef<HTMLParagraphElement | null>(null);
  const focusAfter = useRef<"confirm" | "actions" | null>(null);
  useEffect(() => {
    if (focusAfter.current === "confirm") confirmButton.current?.focus();
    else if (focusAfter.current === "actions") {
      actionButtons.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
    focusAfter.current = null;
  }, [confirming]);

  const endpoint = `/api/projects/${encodeURIComponent(publicId)}/agent-link`;

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
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        setState({ status: "failed" });
        return;
      }
      const payload = (await response.json()) as Partial<AgentLinkStatusResponse>;
      if (!payload.link || typeof payload.link.state !== "string") {
        setState({ status: "failed" });
        return;
      }
      setState({ status: "ready", link: payload.link });
    } catch {
      setState({ status: "failed" });
    }
  }, [endpoint]);

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
      setCopied(null);
    }
  };

  const issue = async () => {
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
      if (!response.ok) {
        setError("The agent link could not be created. Try again.");
        return;
      }
      const payload = (await response.json()) as AgentLinkIssueResponse;
      setState({ status: "ready", link: payload.link });
      setFreshLink(`${window.location.origin}${payload.path}`);
    } catch {
      setError("The agent link could not be created. Try again.");
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
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
      if (!response.ok) {
        setError("The agent link could not be revoked. Try again.");
        return;
      }
      const payload = (await response.json()) as AgentLinkStatusResponse;
      setState({ status: "ready", link: payload.link });
      setFreshLink(null);
      setCopied(null);
    } catch {
      setError("The agent link could not be revoked. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: "link" | "prompt") => {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(what === "link" ? freshLink : agentPrompt(freshLink));
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };

  const link = state.status === "ready" ? state.link : null;
  const summary =
    link === null
      ? null
      : link.state === "none"
        ? "No agent link yet. Create one to give a coding agent a live, read-only brief of this project's open marks and screenshots."
        : link.state === "active"
          ? `Agent link active (version ${link.version}).`
          : `Agent link revoked (was version ${link.version}).`;
  const inlineState =
    link === null
      ? state.status === "failed"
        ? "Link status unavailable"
        : "Checking link…"
      : link.state === "none"
        ? "No agent link"
        : link.state === "active"
          ? `Agent link active · v${link.version}`
          : "Agent link revoked";

  return (
    <div className="founder-share agent-link" data-testid="agent-link">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`agent-link-${publicId}`}
        onClick={toggle}
      >
        Agent link
      </button>
      <span
        className="founder-share-state"
        data-testid="agent-link-state"
        data-state={link?.state ?? state.status}
      >
        {inlineState}
      </span>
      {open ? (
        <div
          id={`agent-link-${publicId}`}
          className="founder-share-panel"
          aria-label={`Agent link for ${projectTitle}`}
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
                Agent link (shown once — copy it now)
                <input
                  type="text"
                  readOnly
                  value={freshLink}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <label className="panel-field">
                Prompt to paste into your agent
                <textarea
                  readOnly
                  rows={3}
                  value={agentPrompt(freshLink)}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <p className="panel-actions">
                <button type="button" onClick={() => void copy("prompt")}>
                  {copied === "prompt" ? "Copied" : "Copy prompt"}
                </button>
                <button type="button" onClick={() => void copy("link")}>
                  {copied === "link" ? "Copied" : "Copy link"}
                </button>
              </p>
              <p className="panel-note">
                Anyone with this link can read the brief and its screenshots, but cannot change
                anything. Pinata stores only a fingerprint of it, so it cannot be shown again.
                Rotate to get a new one.
              </p>
            </div>
          ) : null}
          {link && confirming ? (
            <div
              className="founder-share-confirm"
              role="group"
              aria-labelledby={`agent-link-confirm-${publicId}`}
              data-testid="agent-link-confirm"
            >
              <p id={`agent-link-confirm-${publicId}`}>
                {confirming === "rotate"
                  ? "Rotate the agent link? The link you handed out stops working, and you get a new one."
                  : "Revoke the agent link? The link you handed out stops working until you create a new one."}
              </p>
              <p className="panel-actions">
                <button
                  type="button"
                  ref={confirmButton}
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
          {link && !confirming ? (
            <p className="panel-actions" ref={actionButtons}>
              {link.state === "active" ? (
                <>
                  <button type="button" onClick={() => ask("rotate")} disabled={busy}>
                    Rotate link
                  </button>
                  <button type="button" onClick={() => ask("revoke")} disabled={busy}>
                    Revoke link
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => void issue()} disabled={busy}>
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
