"use client";

// Uploading a capture (D131): the way a screen Pinata cannot visit — one
// behind a sign-in, or only on the editor's machine — gets onto the canvas.
// The file is either a capture file the Pinata Chrome extension saved (a
// screenshot and the page's element list per device) or a plain image.
//
// The panel opens in three places: the overview's "Upload a capture" card
// (the file's address picks the page, or makes a new one), under a capture
// in the canvas view ("Upload a new version", always that page), and on the
// New project page (the upload starts the project). Each device goes up as
// its own request, Desktop first, so the second one lands on the page the
// first one made. A plain image has no element list, so marks on it attach
// to no element; everything else about it is an ordinary capture.

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { MAX_CAPTURE_ATTEMPTS_PER_PROJECT, PROJECT_TITLE_MAX_CHARS } from "../lib/boundaries";
import {
  base64ToBytes,
  guessVariant,
  importErrorMessage,
  packageElementCount,
  parseCapturePackage,
  prepareImage,
  sendImport,
  type CapturePackage,
  type ImportResponse,
  type ImportTarget,
  type UploadVariant,
} from "../lib/capture-upload";
import { normalizeUploadUrl } from "../lib/url/normalize";
import type { WorkspacePage, WorkspaceProject } from "./project-workspace";

export type UploadMode =
  | { kind: "project"; project: WorkspaceProject }
  | { kind: "page"; project: WorkspaceProject; page: WorkspacePage; variant: UploadVariant }
  | { kind: "new-project" };

type Chosen =
  | { kind: "package"; name: string; value: CapturePackage }
  | { kind: "image"; name: string; file: File; width: number; height: number; preview: string };

/** The page select's value for "make a new page from the file's address". */
const NEW_PAGE = "new";

const VARIANT_LABEL: Record<UploadVariant, string> = { desktop: "Desktop", mobile: "Mobile" };

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function packageReason(reason: "not-json" | "not-a-capture" | "version" | "empty"): string {
  if (reason === "version") {
    return "That capture file was made by a newer Pinata extension. Update Pinata and try again.";
  }
  if (reason === "empty") return "That capture file has no screenshots in it.";
  return "That file isn't a Pinata capture file or an image.";
}

/** The project page whose address is this one, if any. */
function pageFor(project: WorkspaceProject | null, url: string): WorkspacePage | null {
  if (!project) return null;
  const normalized = normalizeUploadUrl(url);
  if (!normalized.ok) return null;
  return project.pages.find((page) => page.normalizedUrl === normalized.url) ?? null;
}

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

export function UploadPanel({
  mode,
  onUploaded,
  onPartial,
  onCancel,
}: {
  mode: UploadMode;
  /** Every device went up; the caller refreshes or navigates. */
  onUploaded: (result: ImportResponse, devices: number) => void;
  /** Some devices went up before one failed; the panel stays open. */
  onPartial?: (result: ImportResponse) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const project = mode.kind === "new-project" ? null : mode.project;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Choices on the review step.
  const [pageChoice, setPageChoice] = useState<string>(NEW_PAGE);
  const [variant, setVariant] = useState<UploadVariant>(mode.kind === "page" ? mode.variant : "desktop");
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  // One idempotency key per device per intent: a resend of the same upload
  // converges on one capture; a changed choice starts a new intent.
  const keys = useRef(new Map<UploadVariant, string>());

  useEffect(() => {
    fileInput.current?.focus();
  }, []);

  // Release the image preview with the choice that made it.
  useEffect(() => {
    return () => {
      if (chosen?.kind === "image") URL.revokeObjectURL(chosen.preview);
    };
  }, [chosen]);

  const room = project ? MAX_CAPTURE_ATTEMPTS_PER_PROJECT - project.counts.attempts : null;

  async function choose(file: File) {
    setError(null);
    keys.current.clear();
    if (/\.json$/i.test(file.name) || file.type === "application/json") {
      const parsed = parseCapturePackage(await file.text());
      if (!parsed.ok) {
        setChosen(null);
        setError(packageReason(parsed.reason));
        return;
      }
      const match = pageFor(project, parsed.value.source.url);
      setPageChoice(match ? match.id : NEW_PAGE);
      setAddress(parsed.value.source.url);
      setChosen({ kind: "package", name: file.name, value: parsed.value });
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setChosen(null);
      setError("That file isn't a Pinata capture file or a PNG, JPEG, or WebP image.");
      return;
    }
    const size = await imageSize(file);
    if (!size) {
      setChosen(null);
      setError("That image could not be read.");
      return;
    }
    if (mode.kind === "page") setVariant(mode.variant);
    else setVariant(guessVariant(size.width));
    // An image carries no address; a capture file chosen before it did.
    setAddress("");
    if (mode.kind === "project") setPageChoice(mode.project.pages[0]?.id ?? NEW_PAGE);
    setChosen({
      kind: "image",
      name: file.name,
      file,
      width: size.width,
      height: size.height,
      preview: URL.createObjectURL(file),
    });
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void choose(file);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void choose(file);
  }

  const packageSummary = useMemo(() => {
    if (chosen?.kind !== "package") return null;
    return chosen.value.variants
      .map((entry) => {
        const elements = packageElementCount(entry);
        return `${VARIANT_LABEL[entry.variant]} (${entry.document.width} × ${entry.document.height}, ${elements} ${plural(elements, "element", "elements")})`;
      })
      .join(" and ");
  }, [chosen]);

  /** The first device's target; later devices name the page it landed on. */
  function firstTarget(): ImportTarget | null {
    if (mode.kind === "new-project") {
      return { newProject: title.trim() ? { title: title.trim() } : {} };
    }
    if (mode.kind === "page") return { project: mode.project.publicId, page: mode.page.id };
    return pageChoice === NEW_PAGE
      ? { project: mode.project.publicId }
      : { project: mode.project.publicId, page: pageChoice };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || pending) return;
    setError(null);
    const target = firstTarget();
    if (!target) return;

    // The address that files the upload: the file's own for a capture file;
    // typed for an image that starts a page or a project.
    const needsAddress =
      chosen.kind === "package" ||
      mode.kind === "new-project" ||
      (mode.kind === "project" && pageChoice === NEW_PAGE);
    const url = chosen.kind === "package" ? chosen.value.source.url : address.trim();
    if (needsAddress && !normalizeUploadUrl(url).ok) {
      setError(
        "Type the page's address, starting with http:// or https://, so Pinata knows which page this is.",
      );
      return;
    }

    type Job = {
      variant: UploadVariant;
      document: { width: number; height: number };
      manifest: unknown;
      image: () => Promise<Blob | string>;
    };
    const jobs: Job[] =
      chosen.kind === "package"
        ? chosen.value.variants.map((entry) => ({
            variant: entry.variant,
            document: entry.document,
            manifest: entry.manifest,
            image: async () => {
              const bytes = base64ToBytes(entry.image.base64);
              return bytes
                ? new Blob([bytes as BlobPart], { type: entry.image.contentType })
                : "That capture file's screenshot could not be read.";
            },
          }))
        : [];
    let imageDocument: { width: number; height: number } | null = null;
    if (chosen.kind === "image") {
      setPending("Preparing the image…");
      const prepared = await prepareImage(chosen.file, variant);
      if (!prepared.ok) {
        setPending(null);
        setError(
          prepared.reason === "too-tall"
            ? "That image is too tall for one capture."
            : prepared.reason === "too-large"
              ? "That image is too large to upload, even compressed."
              : "That image could not be read.",
        );
        return;
      }
      imageDocument = { width: prepared.width, height: prepared.height };
      jobs.push({
        variant,
        document: imageDocument,
        manifest: null,
        image: async () => prepared.blob,
      });
    }

    const capturedAt = chosen.kind === "package" ? Date.parse(chosen.value.capturedAt) : NaN;
    let next: ImportTarget = target;
    let last: ImportResponse | null = null;
    for (const job of jobs) {
      setPending(
        jobs.length > 1 ? `Uploading ${VARIANT_LABEL[job.variant]}…` : "Uploading…",
      );
      const image = await job.image();
      if (typeof image === "string") {
        setPending(null);
        setError(image);
        return;
      }
      const key = keys.current.get(job.variant) ?? crypto.randomUUID();
      keys.current.set(job.variant, key);
      const outcome = await sendImport(
        {
          idempotencyKey: key,
          target: next,
          ...(url ? { url } : {}),
          variant: job.variant,
          ...(Number.isFinite(capturedAt) ? { capturedAt } : {}),
          document: job.document,
          manifest: job.manifest,
        },
        image,
      );
      if (!outcome.ok) {
        // A conflict means the key met another upload: the next try is a
        // fresh intent. Devices already sent stay sent.
        if (outcome.status === 409) keys.current.delete(job.variant);
        setPending(null);
        setError(
          last
            ? `${importErrorMessage(outcome)} The ${VARIANT_LABEL[jobs[0]!.variant]} screenshot was uploaded.`
            : importErrorMessage(outcome),
        );
        if (last) onPartial?.(last);
        return;
      }
      last = outcome.value;
      next = { project: outcome.value.project.publicId, page: outcome.value.page.id };
    }
    setPending(null);
    keys.current.clear();
    if (last) onUploaded(last, jobs.length);
  }

  const headingId = `${ids}-heading`;
  const heading =
    mode.kind === "page"
      ? "Upload a new version"
      : mode.kind === "new-project"
        ? "Start from a capture file"
        : "Upload a capture";

  return (
    <form
      className="upload-panel"
      data-testid="upload-panel"
      aria-labelledby={headingId}
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h3 id={headingId}>{heading}</h3>
      <p className="hint">
        {mode.kind === "page"
          ? `A capture file from the Pinata Chrome extension, or an image, as the next version of ${mode.page.normalizedUrl}.`
          : "A capture file from the Pinata Chrome extension — a screenshot plus the page's elements, for screens behind a sign-in — or any PNG, JPEG, or WebP image."}
      </p>

      <label
        className="upload-drop"
        data-dragging={dragging ? "true" : "false"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileInput}
          type="file"
          className="visually-hidden"
          accept=".json,application/json,image/png,image/jpeg,image/webp"
          onChange={onFileChange}
          disabled={pending !== null}
          data-testid="upload-file"
        />
        <span className="upload-drop-label">
          {chosen ? `Chosen: ${chosen.name}` : "Choose a file, or drop it here"}
        </span>
        <span className="upload-drop-hint">.json capture file, PNG, JPEG, or WebP</span>
      </label>

      {chosen?.kind === "package" ? (
        <div className="upload-review" data-testid="upload-review">
          <p>
            Capture of <strong className="upload-url">{chosen.value.source.url}</strong>
          </p>
          <p className="hint">{packageSummary}</p>
        </div>
      ) : null}

      {chosen?.kind === "image" ? (
        <div className="upload-review upload-review-image" data-testid="upload-review">
          <img src={chosen.preview} alt="" className="upload-preview" />
          <div>
            <p>
              {chosen.width} × {chosen.height} image. It has no element list, so marks on it attach
              to no element.
            </p>
            {mode.kind === "page" ? null : (
              <fieldset className="upload-variant">
                <legend>Device</legend>
                {(["desktop", "mobile"] as const).map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`${ids}-variant`}
                      value={value}
                      checked={variant === value}
                      onChange={() => setVariant(value)}
                    />
                    {VARIANT_LABEL[value]}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        </div>
      ) : null}

      {chosen && mode.kind === "project" ? (
        <label className="panel-field upload-page">
          Page
          <select value={pageChoice} onChange={(event) => setPageChoice(event.target.value)}>
            {chosen.kind === "package" && !pageFor(mode.project, chosen.value.source.url) ? (
              <option value={NEW_PAGE}>New page — {chosen.value.source.url}</option>
            ) : null}
            {chosen.kind === "image" ? <option value={NEW_PAGE}>New page…</option> : null}
            {mode.project.pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.normalizedUrl}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {chosen?.kind === "image" &&
      (mode.kind === "new-project" || (mode.kind === "project" && pageChoice === NEW_PAGE)) ? (
        <label className="panel-field upload-address">
          Page address
          <input
            type="url"
            inputMode="url"
            value={address}
            placeholder="https://app.example.com/settings"
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
      ) : null}

      {chosen && mode.kind === "new-project" ? (
        <label className="panel-field upload-title">
          <span>
            Project name <span className="panel-note">(optional)</span>
          </span>
          <input
            type="text"
            value={title}
            maxLength={PROJECT_TITLE_MAX_CHARS}
            placeholder={(() => {
              const url = chosen.kind === "package" ? chosen.value.source.url : address;
              const normalized = normalizeUploadUrl(url);
              return normalized.ok ? new URL(normalized.url).hostname : "The site's name";
            })()}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      ) : null}

      {room !== null && room <= 2 ? (
        <p className="hint">
          {room <= 0
            ? "This project has used up its screenshots."
            : `This project has room for ${room} more ${plural(room, "screenshot", "screenshots")}.`}
        </p>
      ) : null}

      <p className="upload-status" role="status">
        {pending}
      </p>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <p className="form-actions">
        <button type="submit" disabled={!chosen || pending !== null || (room !== null && room <= 0)}>
          {pending ? "Uploading…" : "Upload"}
        </button>
        <button type="button" disabled={pending !== null} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}

/**
 * The overview's next-to-last card: "Upload a capture" (D131), just before
 * "Add pages". Closed, it is a dashed card like that one; open, the panel
 * spans the row.
 */
export function UploadCaptureCard({
  project,
  onUploaded,
}: {
  project: WorkspaceProject;
  onUploaded: (result: ImportResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const openButton = useRef<HTMLButtonElement | null>(null);
  const full = MAX_CAPTURE_ATTEMPTS_PER_PROJECT - project.counts.attempts <= 0;

  if (!open) {
    return (
      <li className="overview-add-slot">
        <button
          type="button"
          ref={openButton}
          className="overview-add"
          data-testid="upload-capture"
          // Named on its own; the line below is its description.
          aria-label="Upload a capture"
          aria-describedby={`upload-capture-note-${project.publicId}`}
          disabled={full}
          onClick={() => {
            setStatus(null);
            setOpen(true);
          }}
        >
          <span className="overview-add-label">
            <span className="overview-add-plus" aria-hidden="true">
              +
            </span>
            Upload a capture
          </span>
          <span className="overview-add-room" id={`upload-capture-note-${project.publicId}`}>
            {full
              ? "This project has used up its screenshots."
              : "From the Pinata extension, or any screenshot"}
          </span>
        </button>
        <p className="overview-add-status" role="status" data-testid="upload-capture-status">
          {status}
        </p>
      </li>
    );
  }
  return (
    <li className="overview-add-slot" data-open="true">
      <UploadPanel
        mode={{ kind: "project", project }}
        onCancel={() => {
          setOpen(false);
          requestAnimationFrame(() => openButton.current?.focus());
        }}
        onPartial={onUploaded}
        onUploaded={(result, devices) => {
          setOpen(false);
          setStatus(
            `Uploaded ${devices === 1 ? "a screenshot" : `${devices} screenshots`} of ${result.page.normalizedUrl}.`,
          );
          onUploaded(result);
        }}
      />
    </li>
  );
}
