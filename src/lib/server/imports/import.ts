// Importing a capture made somewhere else (D131): the Chrome extension's
// screenshot and element list of a page in the editor's own browser, or a
// plain image. One call files one device of one page.
//
// The bytes and the element list are held to the provider path's rules
// before anything is written: the image must decode cleanly as PNG or WebP
// with nothing appended, its real pixel size must equal the document size
// the upload names (the DPR-1 contract that keeps pins, boxes, and element
// rectangles in one coordinate space), and the element list is re-bounded
// by the same pass a provider manifest gets. Then, as on the provider path,
// the image is stored privately first and the rows are written after, in one
// transaction: the idempotency record, a new project or page when the
// upload makes one, and the capture itself — a ready attempt with origin
// `upload`, numbered after the page device's newest attempt. If the
// transaction fails, the stored object is deleted (or recorded for cleanup)
// so it is never left unreferenced.
//
// Idempotency follows the other mutations: the same key and the same upload
// replays the first result without storing anything; the same key with a
// different upload conflicts.

import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, max } from "drizzle-orm";
import {
  DESKTOP_VIEWPORT,
  MANIFEST_SCHEMA_VERSION,
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
  MAX_DOCUMENT_HEIGHT_PX,
  MAX_DOCUMENT_PIXELS,
  MAX_UNIQUE_PAGE_URLS,
  MOBILE_VIEWPORT,
  PROJECT_TITLE_MAX_CHARS,
  UPLOAD_IMAGE_MAX_BYTES,
  captureOutcome,
} from "../../boundaries";
import { normalizeUploadUrl } from "../../url/normalize";
import { recordOrphanCleanup } from "../captures/cleanup";
import { validateCaptureImage } from "../captures/image";
import { boundManifest, type BoundedManifest } from "../captures/manifest";
import { schema, type Database } from "../db/client";
import type { CaptureVariant } from "../db/schema";
import type { ScreenshotStore } from "../providers/blob";
import { defaultCreateProjectDeps } from "../projects/create";
import type { ImportMeta } from "./schemas";

/** Idempotency scope for capture imports. */
export const CAPTURE_IMPORT_SCOPE = "capture-import";

/** Times the write is re-planned when a concurrent upload took its slot. */
const MAX_WRITE_ROUNDS = 3;

const VIEWPORTS = { desktop: DESKTOP_VIEWPORT, mobile: MOBILE_VIEWPORT } as const;

const MANIFEST_TRUNCATED_WARNING = captureOutcome("manifest-truncated").code;

export interface ImportedCapture {
  project: { publicId: string; title: string; created: boolean };
  page: { id: string; normalizedUrl: string; created: boolean };
  capture: { id: string; variant: CaptureVariant; attempt: number; elements: number };
}

/** Bounded, non-echoing reasons an import is refused. */
export type ImportRefusal =
  | "invalid-url"
  | "invalid-image"
  | "image-too-large"
  | "document-too-tall"
  | "too-many-pixels"
  | "too-many-pages"
  | "too-many-captures";

export type ImportCaptureResult =
  | { ok: true; created: boolean; result: ImportedCapture }
  | { ok: false; error: "not-found" | "conflict" | "storage" }
  | { ok: false; error: "refused"; reason: ImportRefusal };

export interface ImportCaptureInput {
  meta: ImportMeta;
  image: { bytes: Uint8Array; contentType: string };
  /** Who sent it; recorded with the capture's warnings for the record. */
  actor: "editor" | "extension";
}

export interface ImportCaptureDeps {
  now: () => number;
  newId: () => string;
  newPublicId: () => string;
}

export const defaultImportCaptureDeps: ImportCaptureDeps = {
  now: () => Date.now(),
  newId: () => randomUUID(),
  newPublicId: defaultCreateProjectDeps.newPublicId,
};

const refused = (reason: ImportRefusal): ImportCaptureResult => ({
  ok: false,
  error: "refused",
  reason,
});

async function findIdempotencyRecord(db: Database, key: string) {
  const rows = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.scope, CAPTURE_IMPORT_SCOPE),
        eq(schema.idempotencyKeys.key, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function replay(
  record: { payloadDigest: string; resultJson: string | null },
  digest: string,
): ImportCaptureResult {
  if (record.payloadDigest !== digest || record.resultJson === null) {
    return { ok: false, error: "conflict" };
  }
  return { ok: true, created: false, result: JSON.parse(record.resultJson) as ImportedCapture };
}

async function liveProject(db: Database, publicId: string) {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.publicId, publicId))
    .limit(1);
  const project = rows[0];
  // Archived projects take nothing new until they are back (D108), the
  // same as a deleted one.
  if (!project || project.deletedAt !== null || project.archivedAt !== null) return null;
  return project;
}

/** The project title a new project gets when the upload names none. */
function defaultTitle(normalizedUrl: string): string {
  return new URL(normalizedUrl).hostname.replace(/^\[|\]$/g, "");
}

function warningPayload(
  input: ImportCaptureInput,
  manifest: BoundedManifest | null,
): string {
  const codes = manifest?.truncated ? [MANIFEST_TRUNCATED_WARNING] : [];
  return JSON.stringify({
    codes,
    source: input.actor === "extension" ? "extension" : manifest ? "file" : "image",
    manifestBytes: manifest?.bytes ?? 0,
    manifestElements: manifest?.manifest.elements.length ?? 0,
    manifestTruncated: manifest?.truncated ?? false,
  });
}

type Plan =
  | {
      kind: "write";
      project: { id: string; publicId: string; title: string; rootUrl: string; created: boolean };
      page: { id: string; normalizedUrl: string; sortIndex: number; created: boolean };
      attempt: number;
    }
  | { kind: "result"; result: ImportCaptureResult };

/**
 * Decide where the capture goes: the project and page it names (or the page
 * its address already is), or the project and page this upload creates,
 * plus the attempt number after the page device's newest — checking the
 * project's page and screenshot limits on the way.
 */
async function plan(
  db: Database,
  meta: ImportMeta,
  normalizedUrl: string | null,
  deps: ImportCaptureDeps,
): Promise<Plan> {
  let project: { id: string; publicId: string; title: string; rootUrl: string; created: boolean };
  if ("newProject" in meta.target) {
    if (!normalizedUrl) return { kind: "result", result: refused("invalid-url") };
    const title = (meta.target.newProject.title ?? "").trim() || defaultTitle(normalizedUrl);
    project = {
      id: deps.newId(),
      publicId: deps.newPublicId(),
      title: title.slice(0, PROJECT_TITLE_MAX_CHARS),
      rootUrl: normalizedUrl,
      created: true,
    };
  } else {
    const found = await liveProject(db, meta.target.project);
    if (!found) return { kind: "result", result: { ok: false, error: "not-found" } };
    project = {
      id: found.id,
      publicId: found.publicId,
      title: found.title,
      rootUrl: found.rootUrl,
      created: false,
    };
  }

  const pageRows = project.created
    ? []
    : await db
        .select({
          id: schema.pages.id,
          normalizedUrl: schema.pages.normalizedUrl,
          sortIndex: schema.pages.sortIndex,
        })
        .from(schema.pages)
        .where(eq(schema.pages.projectId, project.id));

  let page: { id: string; normalizedUrl: string; sortIndex: number; created: boolean };
  const named = "project" in meta.target ? meta.target.page : undefined;
  if (named !== undefined) {
    const found = pageRows.find((row) => row.id === named);
    if (!found) return { kind: "result", result: { ok: false, error: "not-found" } };
    page = { ...found, created: false };
  } else {
    if (!normalizedUrl) return { kind: "result", result: refused("invalid-url") };
    const found = pageRows.find((row) => row.normalizedUrl === normalizedUrl);
    if (found) {
      page = { ...found, created: false };
    } else {
      if (pageRows.length + 1 > MAX_UNIQUE_PAGE_URLS) {
        return { kind: "result", result: refused("too-many-pages") };
      }
      page = {
        id: deps.newId(),
        normalizedUrl,
        sortIndex: pageRows.reduce((top, row) => Math.max(top, row.sortIndex), -1) + 1,
        created: true,
      };
    }
  }

  let attempt = 1;
  if (!project.created) {
    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.captures)
      .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
      .where(eq(schema.pages.projectId, project.id));
    if ((total ?? 0) + 1 > MAX_CAPTURE_ATTEMPTS_PER_PROJECT) {
      return { kind: "result", result: refused("too-many-captures") };
    }
    if (!page.created) {
      const [{ newest }] = await db
        .select({ newest: max(schema.captures.attempt) })
        .from(schema.captures)
        .where(
          and(eq(schema.captures.pageId, page.id), eq(schema.captures.variant, meta.variant)),
        );
      attempt = (newest ?? 0) + 1;
    }
  }
  return { kind: "write", project, page, attempt };
}

async function discard(
  db: Database,
  store: ScreenshotStore,
  stored: { pathname: string; captureId: string },
  now: number,
): Promise<void> {
  let removed = false;
  try {
    const result = await store.del(stored.pathname);
    removed = result.ok || result.error === "not-found";
  } catch {
    removed = false;
  }
  if (!removed) {
    await recordOrphanCleanup(db, { blobPath: stored.pathname, captureId: stored.captureId }, now)
      .catch(() => undefined);
  }
}

/**
 * Validate, store, and file one uploaded capture. The caller has already
 * authorized the editor (or the extension) and parsed `meta` strictly.
 */
export async function importCapture(
  db: Database,
  store: ScreenshotStore,
  input: ImportCaptureInput,
  deps: ImportCaptureDeps = defaultImportCaptureDeps,
): Promise<ImportCaptureResult> {
  const { meta } = input;

  // The bytes first: nothing about an upload is believed until its image
  // decodes and matches the document it claims to show.
  if (input.image.bytes.byteLength > UPLOAD_IMAGE_MAX_BYTES) return refused("image-too-large");
  if (meta.document.height > MAX_DOCUMENT_HEIGHT_PX) return refused("document-too-tall");
  if (meta.document.width * meta.document.height > MAX_DOCUMENT_PIXELS) {
    return refused("too-many-pixels");
  }
  const image = validateCaptureImage({
    declaredContentType: input.image.contentType,
    bytes: input.image.bytes,
    expected: meta.document,
  });
  if (!image.ok) {
    return refused(image.outcome === "image-bytes-exceeded" ? "image-too-large" : "invalid-image");
  }

  let normalizedUrl: string | null = null;
  if (meta.url !== undefined) {
    const normalized = normalizeUploadUrl(meta.url);
    if (!normalized.ok) return refused("invalid-url");
    normalizedUrl = normalized.url;
  }

  const manifest = meta.manifest ? boundManifest(meta.manifest) : null;

  // The target, the page address, the device, and the exact image decide
  // the digest: the same key sent with anything else conflicts.
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        target: meta.target,
        url: normalizedUrl,
        variant: meta.variant,
        image: image.sha256,
      }),
    )
    .digest("hex");
  const existing = await findIdempotencyRecord(db, meta.idempotencyKey);
  if (existing) return replay(existing, digest);

  const now = deps.now();
  const capturedAt = Math.min(meta.capturedAt ?? now, now);
  const viewport = VIEWPORTS[meta.variant];

  for (let round = 0; round < MAX_WRITE_ROUNDS; round += 1) {
    const planned = await plan(db, meta, normalizedUrl, deps);
    if (planned.kind === "result") return planned.result;
    const { project, page, attempt } = planned;

    const captureId = deps.newId();
    const blobPath = `captures/${page.id}/${captureId}-${image.sha256.slice(0, 16)}.${image.format}`;
    let stored: Awaited<ReturnType<ScreenshotStore["put"]>>;
    try {
      stored = await store.put(blobPath, input.image.bytes, image.contentType);
    } catch {
      return { ok: false, error: "storage" };
    }
    if (!stored.ok) return { ok: false, error: "storage" };

    const result: ImportedCapture = {
      project: { publicId: project.publicId, title: project.title, created: project.created },
      page: { id: page.id, normalizedUrl: page.normalizedUrl, created: page.created },
      capture: {
        id: captureId,
        variant: meta.variant,
        attempt,
        elements: manifest?.manifest.elements.length ?? 0,
      },
    };

    try {
      await db.transaction(async (tx) => {
        // The idempotency row first: its primary key is what turns two
        // same-key uploads into one capture.
        await tx.insert(schema.idempotencyKeys).values({
          scope: CAPTURE_IMPORT_SCOPE,
          key: meta.idempotencyKey,
          payloadDigest: digest,
          resultJson: JSON.stringify(result),
          createdAt: now,
        });
        if (project.created) {
          await tx.insert(schema.projects).values({
            id: project.id,
            publicId: project.publicId,
            title: project.title,
            rootUrl: project.rootUrl,
            shareTokenVersion: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (page.created) {
          await tx.insert(schema.pages).values({
            id: page.id,
            projectId: project.id,
            requestedUrl: page.normalizedUrl,
            normalizedUrl: page.normalizedUrl,
            sortIndex: page.sortIndex,
            createdAt: now,
          });
        }
        await tx.insert(schema.captures).values({
          id: captureId,
          pageId: page.id,
          variant: meta.variant,
          attempt,
          status: "ready",
          idempotencyKey: `import:${meta.idempotencyKey}`,
          origin: "upload",
          requestedUrl: page.normalizedUrl,
          finalUrl: normalizedUrl ?? page.normalizedUrl,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
          documentWidth: image.width,
          documentHeight: image.height,
          blobPath: stored.value.pathname,
          blobContentType: image.contentType,
          blobBytes: image.bytes,
          imageHash: image.sha256,
          domManifestJson: manifest?.json ?? null,
          domManifestVersion: manifest ? MANIFEST_SCHEMA_VERSION : null,
          warningJson: warningPayload(input, manifest),
          capturedAt,
          startedAt: now,
          finishedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        if (!project.created) {
          await tx
            .update(schema.projects)
            .set({ updatedAt: now })
            .where(eq(schema.projects.id, project.id));
        }
      });
    } catch (error) {
      await discard(db, store, { pathname: stored.value.pathname, captureId }, deps.now());
      // The same key committed first: converge on its result.
      const winner = await findIdempotencyRecord(db, meta.idempotencyKey);
      if (winner) return replay(winner, digest);
      // Another upload took this attempt number or this address first; plan
      // again against what is there now.
      if (round + 1 < MAX_WRITE_ROUNDS) continue;
      throw error;
    }
    return { ok: true, created: true, result };
  }
  return { ok: false, error: "conflict" };
}
