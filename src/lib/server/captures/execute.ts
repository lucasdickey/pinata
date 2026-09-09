// One claimed attempt, one real Browserless execution, one finalized row
// (VAL-CAPTURE-003, VAL-CAPTURE-004, VAL-CAPTURE-014).
//
// `dispatchCapture` admits the target and claims the attempt; this module is
// what must then always run, because a claim with no execution behind it is
// an attempt stuck in `capturing`. Every exit path here is terminal: ready,
// or failed with a catalog outcome.
//
// Order matters and is not negotiable. The provider result is validated
// before any byte is stored, the bytes are stored privately before the row is
// finalized, and the row is finalized with a fenced transition. Turso and
// Blob are not transactional, so a lost finalization deletes the object it
// just wrote rather than leaving an unreferenced one behind.

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  LAZY_SCROLL_MAX_STEPS,
  LAZY_SCROLL_STEP_DELAY_MS,
  LAZY_SCROLL_STEP_PX,
  MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
  MANIFEST_MAX_CLASSES,
  MANIFEST_PATH_MAX_DEPTH,
  MANIFEST_RECT_DECIMALS,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_TEXT_MAX_CHARS,
  MAX_DOCUMENT_HEIGHT_PX,
  MAX_DOCUMENT_PIXELS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ELEMENTS,
  NAVIGATION_TIMEOUT_MS,
  NETWORK_IDLE_TIMEOUT_MS,
  TOTAL_CAPTURE_TIMEOUT_MS,
  ALLOWED_IMAGE_CONTENT_TYPES,
  captureOutcome,
} from "../../boundaries";
import { schema, type Database } from "../db/client";
import type { BrowserlessClient, BrowserlessRunError } from "../providers/browserless";
import type { ScreenshotStore } from "../providers/blob";
import { deviceProfile } from "./devices";
import { buildCaptureFunctionSource } from "./function-source";
import { validateCaptureImage } from "./image";
import { parseCaptureResponse, serializeManifest, type CaptureSuccessResult } from "./result";
import { applyCaptureTransition } from "./transitions";

/** Slack between the in-page budget and the HTTP deadline, so the function
 * can return a bounded failure instead of being aborted mid-flight. */
const FUNCTION_BUDGET_SLACK_MS = 10_000;

/** Bounded in-page scan budgets; not validation boundaries, just work caps. */
const ANCHOR_SAMPLE_MAX = 48;
const STICKY_SCAN_MAX = 2_000;
const ANIMATED_IMAGE_SCAN_MAX = 12;
const ANIMATED_IMAGE_MAX_BYTES = 4_194_304;

const IMAGE_CONTENT_TYPE = ALLOWED_IMAGE_CONTENT_TYPES[0]!;
const IMAGE_TYPE = IMAGE_CONTENT_TYPE.split("/")[1]!;

export interface CaptureExecutionDeps {
  client: BrowserlessClient | null;
  store: ScreenshotStore | null;
  now?: () => number;
  /** Random per-execution layout nonce; correlates image, manifest, and row. */
  nonce?: () => string;
}

export interface ReadyCapture {
  captureId: string;
  variant: string;
  requestedUrl: string;
  finalUrl: string;
  documentWidth: number;
  documentHeight: number;
  contentType: string;
  bytes: number;
  imageHash: string;
  layoutNonce: string;
  manifestElements: number;
  manifestBytes: number;
  warnings: string[];
}

export type CaptureExecutionResult =
  | { ok: true; capture: ReadyCapture }
  | { ok: false; outcome: string }
  /** The row is not a live claim, so there is nothing to finalize. */
  | { ok: false; error: "not-executable" };

const PROVIDER_ERROR_OUTCOMES: Record<BrowserlessRunError, string> = {
  rejected: "browserless-auth",
  unavailable: "browserless-provider",
  timeout: "total-timeout",
  "too-large": "provider-bytes-exceeded",
};

function limitsForFunction() {
  return {
    navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
    networkIdleTimeoutMs: NETWORK_IDLE_TIMEOUT_MS,
    lazyScrollStepPx: LAZY_SCROLL_STEP_PX,
    lazyScrollMaxSteps: LAZY_SCROLL_MAX_STEPS,
    lazyScrollStepDelayMs: LAZY_SCROLL_STEP_DELAY_MS,
    totalTimeoutMs: TOTAL_CAPTURE_TIMEOUT_MS - FUNCTION_BUDGET_SLACK_MS,
    maxDocumentHeightPx: MAX_DOCUMENT_HEIGHT_PX,
    maxDocumentPixels: MAX_DOCUMENT_PIXELS,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    manifestMaxElements: MAX_MANIFEST_ELEMENTS,
    manifestMaxBytes: MAX_MANIFEST_BYTES,
    textMaxChars: MANIFEST_TEXT_MAX_CHARS,
    nameMaxChars: MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
    maxClasses: MANIFEST_MAX_CLASSES,
    pathMaxDepth: MANIFEST_PATH_MAX_DEPTH,
    rectDecimals: MANIFEST_RECT_DECIMALS,
    anchorSampleMax: ANCHOR_SAMPLE_MAX,
    stickyScanMax: STICKY_SCAN_MAX,
    animatedImageScanMax: ANIMATED_IMAGE_SCAN_MAX,
    animatedImageMaxBytes: ANIMATED_IMAGE_MAX_BYTES,
  };
}

/** Same origin, https, and no credentials — the function may not wander off. */
function finalUrlIsConsistent(admitted: string, reported: string): boolean {
  try {
    const a = new URL(admitted);
    const b = new URL(reported);
    return b.protocol === "https:" && b.username === "" && b.password === "" && a.origin === b.origin;
  } catch {
    return false;
  }
}

function decodeBase64(value: string): Uint8Array | null {
  // Buffer.from is permissive, so round-trip the decode: a body that is not
  // real base64 (an HTML error page, say) never becomes "image bytes".
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0) return null;
  return new Uint8Array(bytes);
}

function warningPayload(result: CaptureSuccessResult, manifestBytes: number): string {
  return JSON.stringify({
    codes: result.warnings,
    blockedRequests: result.blocked.length,
    manifestBytes,
    // The scroll pass is part of the evidence: a capture is only reproducible
    // if the page ended back at the top of the stabilized layout.
    scroll: {
      x: result.document.scrollX,
      y: result.document.scrollY,
      steps: result.document.scrollSteps,
    },
    stabilization: result.stabilization,
  });
}

/**
 * Run the provider for one claimed attempt and finalize it. Never returns
 * without the row having reached `ready` or `failed`, except when the row was
 * not a live claim or the environment is unconfigured.
 */
export async function executeCapture(
  db: Database,
  captureId: string,
  deps: CaptureExecutionDeps,
): Promise<CaptureExecutionResult> {
  const rows = await db
    .select()
    .from(schema.captures)
    .where(eq(schema.captures.id, captureId))
    .limit(1);
  const capture = rows[0];
  if (!capture || capture.status !== "capturing") return { ok: false, error: "not-executable" };

  const now = deps.now ?? (() => Date.now());
  const fail = async (outcome: string): Promise<CaptureExecutionResult> => {
    const entry = captureOutcome(outcome);
    await applyCaptureTransition(db, {
      captureId: capture.id,
      from: "capturing",
      to: "failed",
      now: now(),
      errorCode: entry.code,
      errorMessage: entry.publicMessage,
    });
    return { ok: false, outcome };
  };

  try {
    return await runClaimedCapture(db, capture, deps, now, fail);
  } catch {
    // A claimed attempt may not survive an unexpected throw as an open
    // `capturing` row: every path out of a claim is terminal.
    return fail("browserless-provider");
  }
}

type CaptureRow = typeof schema.captures.$inferSelect;

async function runClaimedCapture(
  db: Database,
  capture: CaptureRow,
  deps: CaptureExecutionDeps,
  now: () => number,
  fail: (outcome: string) => Promise<CaptureExecutionResult>,
): Promise<CaptureExecutionResult> {
  // A missing credential is an operator problem, but it still has to close
  // the claim: the attempt fails with the catalog outcome for that provider.
  if (!deps.client) return fail("browserless-auth");
  if (!deps.store) return fail("blob-failure");

  const profile = deviceProfile(capture.variant);
  if (!profile || !capture.finalUrl) return fail("browserless-provider");

  const layoutNonce = (deps.nonce ?? defaultNonce)();
  const store = deps.store;

  const run = await deps.client.runFunction({
    code: buildCaptureFunctionSource(),
    context: {
      targetUrl: capture.finalUrl,
      variant: profile.variant,
      layoutNonce,
      viewport: profile.viewport,
      userAgent: profile.userAgent,
      imageType: IMAGE_TYPE,
      imageContentType: IMAGE_CONTENT_TYPE,
      limits: limitsForFunction(),
    },
    timeoutMs: TOTAL_CAPTURE_TIMEOUT_MS,
  });
  if (!run.ok) return fail(PROVIDER_ERROR_OUTCOMES[run.error]);

  const result = parseCaptureResponse(run.body);
  if (!result) return fail("browserless-provider");
  if (!result.ok) return fail(result.code);

  if (result.layoutNonce !== layoutNonce) return fail("browserless-provider");
  if (result.variant !== capture.variant) return fail("browserless-provider");
  if (!finalUrlIsConsistent(capture.finalUrl, result.finalUrl)) return fail("unsafe-redirect");
  if (result.document.height > MAX_DOCUMENT_HEIGHT_PX) return fail("document-too-tall");
  if (result.document.height * result.document.width > MAX_DOCUMENT_PIXELS) {
    return fail("too-many-pixels");
  }

  const bytes = decodeBase64(result.image.base64);
  if (!bytes) return fail("invalid-image");
  const image = validateCaptureImage({
    declaredContentType: result.image.contentType,
    bytes,
    expected: { width: result.document.width, height: result.document.height },
  });
  if (!image.ok) return fail(image.outcome);

  const manifest = serializeManifest(result.manifest);
  if (!manifest.ok) return fail("browserless-provider");

  const blobPath = `captures/${capture.pageId}/${capture.id}-${image.sha256.slice(0, 16)}.${IMAGE_TYPE}`;
  const stored = await store.put(blobPath, bytes, image.contentType);
  if (!stored.ok) return fail("blob-failure");

  const transition = await applyCaptureTransition(db, {
    captureId: capture.id,
    from: "capturing",
    to: "ready",
    now: now(),
    finalUrl: result.finalUrl,
    documentWidth: result.document.width,
    documentHeight: result.document.height,
    blobPath: stored.value.pathname,
    blobContentType: image.contentType,
    blobBytes: image.bytes,
    imageHash: image.sha256,
    domManifestJson: manifest.json,
    domManifestVersion: MANIFEST_SCHEMA_VERSION,
    warningJson: warningPayload(result, manifest.bytes),
  });
  if (transition === "fenced") {
    // The claim was lost or the row already reached a terminal state, so this
    // object can never be referenced. Delete it rather than orphan it.
    await store.del(stored.value.pathname);
    return { ok: false, outcome: "finalization-failure" };
  }

  return {
    ok: true,
    capture: {
      captureId: capture.id,
      variant: capture.variant,
      requestedUrl: capture.requestedUrl,
      finalUrl: result.finalUrl,
      documentWidth: result.document.width,
      documentHeight: result.document.height,
      contentType: image.contentType,
      bytes: image.bytes,
      imageHash: image.sha256,
      layoutNonce,
      manifestElements: result.manifest.elements.length,
      manifestBytes: manifest.bytes,
      warnings: result.warnings,
    },
  };
}

function defaultNonce(): string {
  return `layout_${randomBytes(8).toString("hex")}`;
}
