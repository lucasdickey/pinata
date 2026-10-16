"use client";

// Archive and Unarchive keep pages, pins, threads, and capability links intact.
// Archive asks for confirmation; Unarchive restores the project to the active list.

import { useEffect, useRef, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";

export function ArchiveProjectControl({
  publicId,
  projectTitle,
  onArchived,
}: {
  publicId: string;
  projectTitle: string;
  onArchived: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const archiveButton = useRef<HTMLButtonElement | null>(null);
  // Focus follows the step: into Confirm when it appears, back to Archive
  // when it is cancelled.
  const focusAfter = useRef<"confirm" | "archive" | null>(null);

  useEffect(() => {
    if (focusAfter.current === "confirm") confirmButton.current?.focus();
    if (focusAfter.current === "archive") archiveButton.current?.focus();
    focusAfter.current = null;
  }, [confirming]);

  const ask = () => {
    setError(null);
    focusAfter.current = "confirm";
    setConfirming(true);
  };
  const cancel = () => {
    focusAfter.current = "archive";
    setConfirming(false);
  };

  const archive = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(publicId)}/archive`, {
        method: "POST",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
      if (!response.ok) {
        setError("The project could not be archived. Try again.");
        return;
      }
      setConfirming(false);
      onArchived();
    } catch {
      setError("The project could not be archived. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="archive-project" data-testid="archive-project">
      {confirming ? (
        <div className="archive-project-confirm" role="group" aria-label="Confirm archive">
          <p className="archive-project-note">
            Archive {projectTitle}? It leaves the project list. Pins, threads, and the founder
            link stay as they are.
          </p>
          <button
            ref={confirmButton}
            type="button"
            className="archive-project-confirm-button"
            onClick={() => void archive()}
            disabled={pending}
          >
            {pending ? "Archiving…" : "Confirm"}
          </button>
          <button type="button" onClick={cancel} disabled={pending}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          ref={archiveButton}
          type="button"
          aria-label={`Archive ${projectTitle}`}
          onClick={ask}
        >
          Archive
        </button>
      )}
      {error ? (
        <p role="alert" className="archive-project-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function UnarchiveProjectControl({
  publicId,
  projectTitle,
  onUnarchived,
}: {
  publicId: string;
  projectTitle: string;
  onUnarchived: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unarchive = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(publicId)}/archive`, {
        method: "DELETE",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
      if (!response.ok) {
        setError("The project could not be unarchived. Try again.");
        return;
      }
      onUnarchived();
    } catch {
      setError("The project could not be unarchived. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="archive-project">
      <button type="button" aria-label={`Unarchive ${projectTitle}`} disabled={pending} onClick={() => void unarchive()}>
        {pending ? "Unarchiving…" : "Unarchive"}
      </button>
      {error ? <p role="alert" className="archive-project-error">{error}</p> : null}
    </div>
  );
}
