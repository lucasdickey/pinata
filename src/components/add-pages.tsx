"use client";

// "Add pages" on the project overview (D129): the last card in the grid,
// drawn like "+ New project" in the projects menu. Pressing it opens a small
// form in its place, across the whole row: URL rows like the New project
// form's, finished the same way (a bare domain gains https://, a row that
// starts with "/" resolves against the project's root, D097). Submitting
// commits a Desktop and a Mobile screenshot for each new address; the
// overview's re-read shows the new cards with their progress, and the
// polling the editor already runs carries them to ready.
//
// The card shows how much room the project has left — its unique pages and
// its screenshots both have a limit — and an address the project already
// has comes back as skipped, with a note on its row, not as a second page.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import {
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
  MAX_UNIQUE_PAGE_URLS,
} from "../lib/boundaries";
import { readCsrfProof } from "../lib/csrf";
import { completeUrlInput } from "../lib/url/complete";
import { URL_ROW_MESSAGES } from "./project-create-form";
import type { WorkspaceProject } from "./project-workspace";

/** Screenshots one new page takes: Desktop and Mobile. */
const SCREENSHOTS_PER_PAGE = 2;

/** A credential typed into a row must not stay on screen. */
const CLEAR_ON_ERROR = new Set(["credentials"]);

interface UrlRow {
  id: string;
  value: string;
}

interface RowError {
  field: string;
  index: number | null;
  code: string;
}

interface AddPagesResponse {
  added: { id: string; normalizedUrl: string }[];
  skipped: number[];
}

/** How many more pages a project can take, and which limit decides it. */
export function pageRoom(project: Pick<WorkspaceProject, "pages" | "counts">): {
  room: number;
  limit: "pages" | "screenshots";
} {
  const byPages = Math.max(0, MAX_UNIQUE_PAGE_URLS - project.pages.length);
  const byScreenshots = Math.max(
    0,
    Math.floor((MAX_CAPTURE_ATTEMPTS_PER_PROJECT - project.counts.attempts) / SCREENSHOTS_PER_PAGE),
  );
  return byScreenshots < byPages
    ? { room: byScreenshots, limit: "screenshots" }
    : { room: byPages, limit: "pages" };
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function formMessage(code: string): string {
  if (code === "too-many-pages") {
    return `A project holds up to ${MAX_UNIQUE_PAGE_URLS} pages. Remove a row and try again.`;
  }
  if (code === "too-many-captures") {
    return "This project has used up its screenshots, so it can't take that many new pages. Remove a row and try again.";
  }
  if (code === "too-many-rows") return "Too many rows. Remove some and try again.";
  return "Please correct the entries above.";
}

export function AddPagesCard({
  project,
  onAdded,
}: {
  project: WorkspaceProject;
  /** Re-read the hierarchy so the new pages' cards appear. */
  onAdded: () => void;
}) {
  const { room, limit } = pageRoom(project);
  const nextRowId = useRef(0);
  const makeRow = (): UrlRow => ({ id: `add-page-row-${(nextRowId.current += 1)}`, value: "" });

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<UrlRow[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One key per intent, as in the New project form: a resend of the same
  // rows converges on one addition; a changed form gets a fresh key on 409.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  const openButton = useRef<HTMLButtonElement | null>(null);
  const addRowButton = useRef<HTMLButtonElement | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  useEffect(() => {
    if (focusTarget === null) return;
    if (focusTarget === "open") openButton.current?.focus();
    else if (focusTarget === "add-row") addRowButton.current?.focus();
    else inputs.current.get(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  function show() {
    const row = makeRow();
    setRows([row]);
    setRowErrors({});
    setFormError(null);
    setStatus(null);
    setOpen(true);
    setFocusTarget(row.id);
  }

  function close() {
    setOpen(false);
    setRows([]);
    setRowErrors({});
    setFormError(null);
    setIdempotencyKey(crypto.randomUUID());
    setFocusTarget("open");
  }

  function addRow() {
    const row = makeRow();
    setRows((current) => [...current, row]);
    setFocusTarget(row.id);
  }

  function removeRow(index: number) {
    const removed = rows[index];
    if (!removed) return;
    const remaining = rows.filter((_, position) => position !== index);
    setRows(remaining);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[removed.id];
      return next;
    });
    inputs.current.delete(removed.id);
    const focusIndex = Math.min(index, remaining.length - 1);
    setFocusTarget(focusIndex < 0 ? "add-row" : remaining[focusIndex]!.id);
  }

  function setRowValue(id: string, value: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, value } : row)));
  }

  function applyErrors(submitted: UrlRow[], errors: RowError[]) {
    const nextRowErrors: Record<string, string> = {};
    const cleared: string[] = [];
    let nextForm: string | null = null;
    for (const error of errors) {
      const row = error.index === null ? undefined : submitted[error.index];
      if (error.field === "urls" && row) {
        nextRowErrors[row.id] = URL_ROW_MESSAGES[error.code] ?? "Please correct this entry.";
        if (CLEAR_ON_ERROR.has(error.code)) cleared.push(row.id);
      } else {
        nextForm = formMessage(error.code);
      }
    }
    setRowErrors(nextRowErrors);
    setFormError(nextForm);
    if (cleared.length > 0) {
      setRows((current) =>
        current.map((row) => (cleared.includes(row.id) ? { ...row, value: "" } : row)),
      );
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // Enter can submit without a blur: finish the addresses here too, and
    // show them in the fields before they are sent.
    const submitted = rows.map((row) => ({
      ...row,
      value: completeUrlInput(row.value, project.rootUrl),
    }));
    setRows(submitted);
    setRowErrors({});
    setFormError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.publicId)}/pages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [EDITOR_CSRF_HEADER]: readCsrfProof(),
        },
        body: JSON.stringify({ urls: submitted.map((row) => row.value), idempotencyKey }),
      });
      if (response.ok) {
        const payload = (await response.json()) as AddPagesResponse;
        const added = payload.added.length;
        const skipped = payload.skipped.length;
        if (added === 0) {
          // Nothing new: every address is already a page here. Say so on
          // each row and leave the form open to change them.
          const notes: Record<string, string> = {};
          for (const index of payload.skipped) {
            const row = submitted[index];
            if (row) notes[row.id] = "Already in this project.";
          }
          setRowErrors(notes);
          setFormError("Nothing to add: every address is already in this project.");
          setIdempotencyKey(crypto.randomUUID());
          return;
        }
        setStatus(
          `Added ${added} ${plural(added, "page", "pages")}. ${plural(added, "Its", "Their")} screenshots are on the way.` +
            (skipped > 0
              ? ` Skipped ${skipped} already in this project.`
              : ""),
        );
        close();
        onAdded();
        return;
      }
      if (response.status === 422) {
        const payload = (await response.json()) as { errors?: RowError[] };
        applyErrors(submitted, payload.errors ?? []);
        return;
      }
      if (response.status === 409) {
        setIdempotencyKey(crypto.randomUUID());
        setFormError("This project changed while you were adding pages. Check the rows and try again.");
        return;
      }
      if (response.status === 404) {
        setFormError("This project is no longer in your list. Reload the page.");
        return;
      }
      setFormError("Pinata could not add the pages. Your entries are unchanged; try again.");
    } catch {
      setFormError("Pinata could not reach the server. Your entries are unchanged; try again.");
    } finally {
      setPending(false);
    }
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !pending) {
      event.stopPropagation();
      close();
    }
  }

  if (!open) {
    const full =
      limit === "pages"
        ? `This project has the most pages it can hold (${MAX_UNIQUE_PAGE_URLS}).`
        : "This project has used up its screenshots, so it can't take new pages.";
    return (
      <li className="overview-add-slot">
        <button
          type="button"
          ref={openButton}
          className="overview-add"
          data-testid="add-pages"
          // Named on its own; the room line below is its description.
          aria-label="Add pages"
          disabled={room === 0}
          aria-describedby={`add-pages-room-${project.publicId}`}
          onClick={show}
        >
          <span className="overview-add-label">
            <span className="overview-add-plus" aria-hidden="true">
              +
            </span>
            Add pages
          </span>
          <span className="overview-add-room" id={`add-pages-room-${project.publicId}`}>
            {room === 0 ? full : `Room for ${room} more ${plural(room, "page", "pages")}`}
          </span>
        </button>
        <p className="overview-add-status" role="status" data-testid="add-pages-status">
          {status}
        </p>
      </li>
    );
  }

  const headingId = `add-pages-heading-${project.publicId}`;
  const origin = new URL(project.rootUrl).origin;
  return (
    <li className="overview-add-slot" data-open="true">
      <form
        className="overview-add-form"
        data-testid="add-pages-form"
        aria-labelledby={headingId}
        noValidate
        onSubmit={onSubmit}
        onKeyDown={onFormKeyDown}
      >
        <h3 id={headingId}>Add pages</h3>
        <p className="hint">
          Each address gets a Desktop and a Mobile screenshot. Type a full address, or a path like
          /pricing. Room for {room} more {plural(room, "page", "pages")}.
        </p>
        <ol className="add-page-rows">
          {rows.map((row, index) => {
            const error = rowErrors[row.id];
            const inputId = `${row.id}-input`;
            const errorId = `${row.id}-error`;
            return (
              <li key={row.id}>
                <label htmlFor={inputId}>URL {index + 1}</label>
                <input
                  id={inputId}
                  type="url"
                  inputMode="url"
                  value={row.value}
                  placeholder={`${origin}/pricing`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  ref={(element) => {
                    inputs.current.set(row.id, element);
                  }}
                  onChange={(event) => setRowValue(row.id, event.target.value)}
                  onBlur={() => setRowValue(row.id, completeUrlInput(row.value, project.rootUrl))}
                />
                {rows.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove URL ${index + 1}`}
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </button>
                ) : null}
                {error ? (
                  <span id={errorId} className="field-error" role="alert">
                    {error}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          ref={addRowButton}
          className="add-page-row"
          onClick={addRow}
          disabled={rows.length >= room}
        >
          Add another URL
        </button>
        {formError ? (
          <p className="field-error" role="alert">
            {formError}
          </p>
        ) : null}
        <p className="form-actions">
          <button type="submit" disabled={pending}>
            {pending ? "Adding…" : rows.length === 1 ? "Add page" : "Add pages"}
          </button>
          <button type="button" disabled={pending} onClick={close}>
            Cancel
          </button>
        </p>
      </form>
    </li>
  );
}
