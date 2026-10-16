"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AgentLinkControl } from "./agent-link";
import { CanvasIcon } from "./canvas-icons";
import { FounderShareControl } from "./founder-share";

type Choice = "agent" | "person" | "markdown";
type CopyState = "idle" | "copied" | "failed";

const choices: { id: Choice; label: string }[] = [
  { id: "agent", label: "Coding agent" },
  { id: "person", label: "Person review" },
  { id: "markdown", label: "Markdown" },
];

export function SendSheet({
  publicId,
  projectTitle,
  markdown,
  markdownReady,
  onIssuingChange,
}: {
  publicId: string;
  projectTitle: string;
  markdown: () => string;
  markdownReady: boolean;
  onIssuingChange?: (issuing: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("agent");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [issuing, setIssuing] = useState(false);
  const issuingRef = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) firstChoice.current?.focus();
  }, [open]);
  const reportIssuingChange = (pending: boolean) => {
    issuingRef.current = pending;
    setIssuing(pending);
    onIssuingChange?.(pending);
  };

  const close = () => {
    if (issuingRef.current) return;
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };

  const copyMarkdown = async () => {
    if (!markdownReady) return;
    try {
      await navigator.clipboard.writeText(markdown());
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="send-control" data-testid="send-control">
      <button
        type="button"
        className="send-toggle"
        ref={button}
        aria-expanded={open}
        aria-controls={`send-sheet-${publicId}`}
        disabled={issuing}
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            setChoice("agent");
            setCopyState("idle");
          }
        }}
      >
        <CanvasIcon name="link" size={16} />
        Send
        <CanvasIcon name="caret-down" size={14} />
      </button>
      {open ? (
        <div
          id={`send-sheet-${publicId}`}
          className="send-sheet"
          role="dialog"
          aria-label={`Send ${projectTitle}`}
          aria-busy={issuing}
          onKeyDown={onKeyDown}
        >
          <div className="send-sheet-head">
            <h3>Send {projectTitle}</h3>
            <button
              type="button"
              className="link-panel-close"
              aria-label="Close Send"
              disabled={issuing}
              onClick={close}
            >
              <CanvasIcon name="close" size={16} />
            </button>
          </div>
          <div className="send-choices" role="tablist" aria-label="Send to">
            {choices.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                id={`send-choice-${id}-${publicId}`}
                ref={id === "agent" ? firstChoice : undefined}
                role="tab"
                aria-selected={choice === id}
                aria-controls={`send-${id}-${publicId}`}
                tabIndex={choice === id ? 0 : -1}
                disabled={issuing}
                onClick={() => {
                  if (!issuingRef.current) setChoice(id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  if (issuingRef.current) return;
                  const index = choices.findIndex((item) => item.id === id);
                  const next =
                    choices[
                      (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) %
                        choices.length
                    ]!;
                  setChoice(next.id);
                  document.getElementById(`send-choice-${next.id}-${publicId}`)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {issuing ? <p role="status">Making the link… Keep Send open until it appears.</p> : null}
          <div
            id={`send-agent-${publicId}`}
            className="send-sheet-section"
            role="tabpanel"
            aria-labelledby={`send-choice-agent-${publicId}`}
            hidden={choice !== "agent"}
          >
            {choice === "agent" ? (
              <AgentLinkControl
                publicId={publicId}
                projectTitle={projectTitle}
                onClose={close}
                onIssuingChange={reportIssuingChange}
              />
            ) : null}
          </div>
          <div
            id={`send-person-${publicId}`}
            className="send-sheet-section"
            role="tabpanel"
            aria-labelledby={`send-choice-person-${publicId}`}
            hidden={choice !== "person"}
          >
            {choice === "person" ? (
              <FounderShareControl
                publicId={publicId}
                projectTitle={projectTitle}
                onClose={close}
                onIssuingChange={reportIssuingChange}
              />
            ) : null}
          </div>
          <div
            id={`send-markdown-${publicId}`}
            className="send-sheet-section send-markdown"
            role="tabpanel"
            aria-labelledby={`send-choice-markdown-${publicId}`}
            hidden={choice !== "markdown"}
          >
            <p>Copy every note in this project, including replies, as Markdown. No link is made.</p>
            <button
              type="button"
              className="button-primary"
              disabled={!markdownReady}
              onClick={() => void copyMarkdown()}
            >
              <CanvasIcon name="copy" size={15} />
              Copy project Markdown
            </button>
            <p role="status">
              {!markdownReady
                ? "Project notes are not available yet."
                : copyState === "copied"
                  ? "Project Markdown copied."
                  : copyState === "failed"
                    ? "Could not reach the clipboard. Try again."
                    : null}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
