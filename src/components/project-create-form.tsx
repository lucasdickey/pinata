"use client";

// The project entry form: one required root URL plus an optional explicit URL
// array (VAL-PROJECT-006). Rows have stable identities, every control is a
// real button so the whole editor is keyboard-operable, the server's
// corrections land on the exact rows that caused them without clearing the
// others, credential-bearing input is dropped rather than retained, and
// Cancel writes nothing.
//
// Pinata never discovers URLs: what is typed here is exactly what gets
// captured.

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  MAX_SUBMITTED_URL_ROWS,
  MAX_UNIQUE_PAGE_URLS,
  PROJECT_TITLE_MAX_CHARS,
} from "../lib/boundaries";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";

export interface CreatedProjectView {
  projectId: string;
  publicId: string;
  title: string;
  rootUrl: string;
  pages: {
    id: string;
    normalizedUrl: string;
    sortIndex: number;
    captures: { id: string; variant: string; status: string }[];
  }[];
}

interface UrlRow {
  id: string;
  value: string;
}

interface RowError {
  field: "rootUrl" | "urls" | "title" | "form";
  index: number | null;
  code: string;
}

const ROW_MESSAGES: Record<string, string> = {
  blank: "Enter a public https:// address.",
  malformed: "Pinata cannot read this as a web address.",
  relative: "Enter the full address, starting with https://.",
  scheme: "Only public https:// addresses can be captured.",
  credentials: "Remove the username and password from the address.",
  "ip-literal": "Enter a public domain name, not an IP address.",
  port: "Only the default HTTPS port is supported.",
  "not-public": "This address is not reachable on the public internet.",
  "too-long": "This address is too long.",
};

const FORM_MESSAGES: Record<string, string> = {
  "too-many-rows": `Too many rows. Pinata accepts ${MAX_SUBMITTED_URL_ROWS} URLs including the root.`,
  "too-many-pages": `Too many pages. Pinata captures ${MAX_UNIQUE_PAGE_URLS} unique pages per project.`,
};

const message = (code: string, table: Record<string, string>) =>
  table[code] ?? "Please correct this entry.";

/** A row whose value carries credentials must not stay in the DOM. */
const CLEAR_ON_ERROR = new Set(["credentials"]);

export function ProjectCreateForm(props: {
  onCreated: (project: CreatedProjectView) => void;
  onCancel: () => void;
}) {
  const nextRowId = useRef(0);
  const makeRow = (): UrlRow => ({ id: `url-row-${(nextRowId.current += 1)}`, value: "" });

  const [title, setTitle] = useState("");
  const [rootUrl, setRootUrl] = useState("");
  const [rows, setRows] = useState<UrlRow[]>([]);
  const [rootError, setRootError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One key per intent: a retry of the same submission converges on one
  // project, while a deliberate new submission gets a new key.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  useEffect(() => {
    if (focusTarget === null) return;
    if (focusTarget === "add") addButton.current?.focus();
    else inputs.current.get(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  function clearErrors() {
    setRootError(null);
    setTitleError(null);
    setRowErrors({});
    setFormError(null);
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
    setFocusTarget(focusIndex < 0 ? "add" : remaining[focusIndex]!.id);
  }

  function moveRow(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row!);
    setRows(next);
  }

  function reset() {
    setTitle("");
    setRootUrl("");
    setRows([]);
    clearErrors();
    setIdempotencyKey(crypto.randomUUID());
  }

  function applyErrors(errors: RowError[]) {
    const nextRowErrors: Record<string, string> = {};
    let nextRoot: string | null = null;
    let nextTitle: string | null = null;
    let nextForm: string | null = null;
    const clearedRows: string[] = [];
    let clearRoot = false;

    for (const error of errors) {
      if (error.field === "rootUrl") {
        nextRoot = message(error.code, ROW_MESSAGES);
        if (CLEAR_ON_ERROR.has(error.code)) clearRoot = true;
      } else if (error.field === "title") {
        nextTitle = `Keep the title under ${PROJECT_TITLE_MAX_CHARS} characters.`;
      } else if (error.field === "form") {
        nextForm = message(error.code, FORM_MESSAGES);
      } else if (error.index !== null && rows[error.index]) {
        const row = rows[error.index]!;
        nextRowErrors[row.id] = message(error.code, ROW_MESSAGES);
        if (CLEAR_ON_ERROR.has(error.code)) clearedRows.push(row.id);
      }
    }

    setRootError(nextRoot);
    setTitleError(nextTitle);
    setRowErrors(nextRowErrors);
    setFormError(nextForm);
    if (clearRoot) setRootUrl("");
    if (clearedRows.length > 0) {
      setRows((current) =>
        current.map((row) => (clearedRows.includes(row.id) ? { ...row, value: "" } : row)),
      );
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    clearErrors();
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [EDITOR_CSRF_HEADER]: readCsrfProof(),
        },
        body: JSON.stringify({
          ...(title.trim() === "" ? {} : { title: title.trim() }),
          rootUrl,
          urls: rows.map((row) => row.value),
          idempotencyKey,
        }),
      });

      if (response.ok) {
        const payload = (await response.json()) as { project: CreatedProjectView };
        reset();
        props.onCreated(payload.project);
        return;
      }
      if (response.status === 422) {
        const payload = (await response.json()) as { errors?: RowError[] };
        applyErrors(payload.errors ?? []);
        return;
      }
      if (response.status === 409) {
        // The previous submission already created a project under this key.
        setIdempotencyKey(crypto.randomUUID());
        setFormError("This form changed after it was submitted. Review it and submit again.");
        return;
      }
      setFormError("Pinata could not create the project. Your entries are unchanged; try again.");
    } catch {
      setFormError("Pinata could not reach the server. Your entries are unchanged; try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="project-create-heading" className="project-create">
      <h2 id="project-create-heading">New project</h2>
      <form onSubmit={onSubmit} noValidate>
        <p className="field">
          <label htmlFor="project-title">Project name (optional)</label>
          <input
            id="project-title"
            name="title"
            type="text"
            value={title}
            maxLength={PROJECT_TITLE_MAX_CHARS}
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? "project-title-error" : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
        </p>
        {titleError ? (
          <p id="project-title-error" className="field-error" role="alert">
            {titleError}
          </p>
        ) : null}

        <p className="field">
          <label htmlFor="project-root-url">Root URL</label>
          <input
            id="project-root-url"
            name="rootUrl"
            type="url"
            inputMode="url"
            required
            placeholder="https://example.com"
            value={rootUrl}
            aria-invalid={rootError ? true : undefined}
            aria-describedby={rootError ? "project-root-url-error" : undefined}
            onChange={(event) => setRootUrl(event.target.value)}
          />
        </p>
        {rootError ? (
          <p id="project-root-url-error" className="field-error" role="alert">
            {rootError}
          </p>
        ) : null}

        <fieldset className="url-rows">
          <legend>Additional URLs (optional)</legend>
          <p className="hint">
            Pinata captures exactly these addresses, in this order. It never follows links.
          </p>
          {rows.length === 0 ? <p className="hint">No additional URLs yet.</p> : null}
          <ol>
            {rows.map((row, index) => {
              const error = rowErrors[row.id];
              const inputId = `${row.id}-input`;
              const errorId = `${row.id}-error`;
              return (
                <li key={row.id}>
                  <label htmlFor={inputId}>URL {index + 2}</label>
                  <input
                    id={inputId}
                    type="url"
                    inputMode="url"
                    value={row.value}
                    placeholder="https://example.com/pricing"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    ref={(element) => {
                      inputs.current.set(row.id, element);
                    }}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((candidate) =>
                          candidate.id === row.id
                            ? { ...candidate, value: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                  <span className="row-controls">
                    <button
                      type="button"
                      aria-label={`Move URL ${index + 2} up`}
                      onClick={() => moveRow(index, -1)}
                      disabled={index === 0}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move URL ${index + 2} down`}
                      onClick={() => moveRow(index, 1)}
                      disabled={index === rows.length - 1}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove URL ${index + 2}`}
                      onClick={() => removeRow(index)}
                    >
                      Remove
                    </button>
                  </span>
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
            ref={addButton}
            onClick={addRow}
            disabled={rows.length >= MAX_SUBMITTED_URL_ROWS - 1}
          >
            Add URL
          </button>
        </fieldset>

        {formError ? (
          <p className="field-error" role="alert">
            {formError}
          </p>
        ) : null}

        <p className="form-actions">
          <button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              props.onCancel();
            }}
          >
            Cancel
          </button>
        </p>
      </form>
    </section>
  );
}
