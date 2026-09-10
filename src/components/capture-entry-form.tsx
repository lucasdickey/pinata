"use client";

// The anonymous capture entry on the landing page (VAL-LANDING-001,
// VAL-LANDING-003, D066/D067): one required root URL plus optional
// additional-URL rows and one visible primary action. Submitting never calls
// the API — an anonymous visitor is not authorized to create anything.
// Instead the entry is parked in sessionStorage and the visitor is routed to
// the editor sign-in prompt (focus moves to the password field, honoring
// reduced motion for the scroll). After sign-in, the editor's always-active
// project form consumes the draft with every URL retained, and exactly one
// POST /api/projects creates the project.
//
// Pinata never discovers URLs: what is typed here is exactly what gets
// captured.

import { useRef, useState, type FormEvent } from "react";
import { MAX_SUBMITTED_URL_ROWS } from "../lib/boundaries";
import { saveCaptureDraft } from "../lib/capture-draft";

interface UrlRow {
  id: string;
  value: string;
}

export function CaptureEntryForm() {
  const nextRowId = useRef(0);
  const [rootUrl, setRootUrl] = useState("");
  const [rows, setRows] = useState<UrlRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [routed, setRouted] = useState(false);
  const rootInput = useRef<HTMLInputElement | null>(null);

  function addRow() {
    nextRowId.current += 1;
    setRows((current) => [...current, { id: `entry-url-row-${nextRowId.current}`, value: "" }]);
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const root = rootUrl.trim();
    if (root === "") {
      setError("Enter a public https:// address.");
      rootInput.current?.focus();
      return;
    }
    setError(null);
    // Park the draft, then route to the sign-in prompt. No request leaves
    // the page: the project is created only after the editor signs in.
    saveCaptureDraft({
      rootUrl: root,
      urls: rows.map((row) => row.value.trim()).filter((value) => value !== ""),
    });
    setRouted(true);
    const field = document.getElementById("editor-password");
    if (field instanceof HTMLElement) {
      const reduce =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      field.focus({ preventScroll: true });
      field.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
  }

  return (
    <section aria-labelledby="capture-entry-heading" className="project-create capture-entry">
      <h2 id="capture-entry-heading">Capture a page</h2>
      <form onSubmit={onSubmit} noValidate>
        <p className="field">
          <label htmlFor="entry-root-url">Root URL</label>
          <input
            id="entry-root-url"
            ref={rootInput}
            name="rootUrl"
            type="url"
            inputMode="url"
            required
            placeholder="https://example.com"
            value={rootUrl}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "entry-root-url-error" : undefined}
            onChange={(event) => setRootUrl(event.target.value)}
          />
        </p>
        {error ? (
          <p id="entry-root-url-error" className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        <fieldset className="url-rows">
          <legend>Additional URLs (optional)</legend>
          <p className="hint">
            Pinata captures exactly these addresses, in this order. It never follows links.
          </p>
          {rows.length === 0 ? <p className="hint">No additional URLs yet.</p> : null}
          <ol>
            {rows.map((row, index) => (
              <li key={row.id}>
                <label htmlFor={`${row.id}-input`}>URL {index + 2}</label>
                <input
                  id={`${row.id}-input`}
                  type="url"
                  inputMode="url"
                  value={row.value}
                  placeholder="https://example.com/pricing"
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
                    aria-label={`Remove URL ${index + 2}`}
                    onClick={() => removeRow(row.id)}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= MAX_SUBMITTED_URL_ROWS - 1}
          >
            Add URL
          </button>
        </fieldset>

        {routed ? (
          <p role="status">
            Saved. Sign in below — your entry is waiting in the project form.
          </p>
        ) : null}

        <p className="form-actions">
          <button type="submit">Start capturing</button>
        </p>
      </form>
    </section>
  );
}
