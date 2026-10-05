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

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import {
  agentPrompt,
  type AgentLinkIssueResponse,
  type AgentLinkStatusResponse,
  type AgentLinkView,
} from "../lib/agent-link";
import { CanvasIcon } from "./canvas-icons";

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
  const toggleButton = useRef<HTMLButtonElement | null>(null);
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
  // What the link is for, or what state it is in, as the panel's first line.
  const lede =
    link === null
      ? null
      : link.state === "none"
        ? "A secret link to a live, read-only brief of this project's open marks and screenshots. Paste it into any coding agent."
        : link.state === "active"
          ? `Version ${link.version} is live. Rotate to replace it, or revoke to turn it off.`
          : "The link is off. Create a new one to hand the brief to an agent again."
  // The short form beside the toggle, always visible (D075, D122).
  const chipState =
    link === null
      ? state.status === "failed"
        ? "Unavailable"
        : "Checking…"
      : link.state === "none"
        ? "Off"
        : link.state === "active"
          ? `Active · v${link.version}`
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
    <div className="link-control" data-testid="agent-link" data-open={open}>
      <div className="link-chip" data-state={link?.state ?? state.status}>
        <button
          type="button"
          className="link-chip-toggle"
          ref={toggleButton}
          aria-expanded={open}
          aria-controls={`agent-link-${publicId}`}
          onClick={toggle}
        >
          <CanvasIcon name="agent" size={16} />
          Agent link
          <CanvasIcon name="caret-down" size={14} />
        </button>
        <span
          className="link-chip-state"
          data-testid="agent-link-state"
          data-state={link?.state ?? state.status}
        >
          {chipState}
        </span>
      </div>
      {open ? (
        <div
          id={`agent-link-${publicId}`}
          className="link-panel"
          aria-label={`Agent link for ${projectTitle}`}
          role="group"
          onKeyDown={onPanelKeyDown}
        >
          <div className="link-panel-head">
            <p className="link-panel-title">Agent link</p>
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
              <label className="link-field-label" htmlFor={`agent-link-url-${publicId}`}>
                Agent link (shown once — copy it now)
              </label>
              <div className="link-copy-row">
                <input
                  id={`agent-link-url-${publicId}`}
                  type="text"
                  readOnly
                  value={freshLink}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button type="button" onClick={() => void copy("link")}>
                  <CanvasIcon name="copy" size={15} />
                  {copied === "link" ? "Copied" : "Copy link"}
                </button>
              </div>
              <label className="link-field-label" htmlFor={`agent-link-prompt-${publicId}`}>
                Prompt to paste into your agent
              </label>
              <div className="link-prompt">
                <textarea
                  id={`agent-link-prompt-${publicId}`}
                  readOnly
                  rows={5}
                  value={agentPrompt(freshLink)}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <div className="link-prompt-foot">
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => void copy("prompt")}
                  >
                    <CanvasIcon name="copy" size={15} />
                    {copied === "prompt" ? "Copied" : "Copy prompt"}
                  </button>
                </div>
              </div>
              <p className="link-panel-note">
                Anyone with this link can read the brief and its screenshots, but cannot change
                anything. It is shown once: Pinata keeps only a fingerprint of it.
              </p>
            </div>
          ) : null}
          {link && confirming ? (
            <div
              className="link-confirm"
              role="group"
              aria-labelledby={`agent-link-confirm-${publicId}`}
              data-testid="agent-link-confirm"
            >
              <p id={`agent-link-confirm-${publicId}`}>
                {confirming === "rotate"
                  ? "Rotate the agent link? The link you handed out stops working, and you get a new one."
                  : "Revoke the agent link? The link you handed out stops working until you create a new one."}
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
          {link && !confirming ? (
            <p className="link-panel-actions" ref={actionButtons}>
              {link.state === "active" ? (
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
