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
  MANIFEST_HINT_MAX_CHARS,
  MANIFEST_MAX_CLASSES,
  MANIFEST_MAX_COMBINING_MARKS,
  MANIFEST_PATH_MAX_DEPTH,
  MANIFEST_RECT_DECIMALS,
  MANIFEST_RECT_MAX_PX,
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
import { recordOrphanCleanup } from "./cleanup";
import { buildCaptureFunctionSource } from "./function-source";
import { validateCaptureImage } from "./image";
import { boundManifest, DOCUMENT_TITLE_MAX_CHARS, type BoundedManifest } from "./manifest";
import { parseCaptureResponse, type CaptureSuccessResult } from "./result";
import { applyCaptureTransition } from "./transitions";

/** Slack between the in-page budget and the HTTP deadline, so the function
 * can return a bounded failure instead of being aborted mid-flight. */
const FUNCTION_BUDGET_SLACK_MS = 10_000;

/** Bounded in-page scan budgets; not validation boundaries, just work caps. */
const ANCHOR_SAMPLE_MAX = 48;
const STICKY_SCAN_MAX = 2_000;
const ANIMATED_IMAGE_SCAN_MAX = 12;
const ANIMATED_IMAGE_MAX_BYTES = 4_194_304;
const VISIBILITY_MAX_DEPTH = 64;
const TEXT_NODE_SCAN_MAX = 400;
const CANDIDATE_SCAN_MAX = 20_000;
const SIBLING_SCAN_MAX = 5_000;
const MANIFEST_SHRINK_MAX_ROUNDS = 32;

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
  manifestTruncated: boolean;
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

/**
 * The exact `context.limits` object every capture function receives. Exported
 * so the in-page manifest tests run against the same budgets production does.
 */
export function captureFunctionLimits() {
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
    manifestShrinkMaxRounds: MANIFEST_SHRINK_MAX_ROUNDS,
    textMaxChars: MANIFEST_TEXT_MAX_CHARS,
    nameMaxChars: MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
    hintMaxChars: MANIFEST_HINT_MAX_CHARS,
    documentTitleMaxChars: DOCUMENT_TITLE_MAX_CHARS,
    maxClasses: MANIFEST_MAX_CLASSES,
    pathMaxDepth: MANIFEST_PATH_MAX_DEPTH,
    rectDecimals: MANIFEST_RECT_DECIMALS,
    rectMaxPx: MANIFEST_RECT_MAX_PX,
    markMaxRun: MANIFEST_MAX_COMBINING_MARKS,
    visibilityMaxDepth: VISIBILITY_MAX_DEPTH,
    textNodeScanMax: TEXT_NODE_SCAN_MAX,
    candidateScanMax: CANDIDATE_SCAN_MAX,
    siblingScanMax: SIBLING_SCAN_MAX,
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

/** Published warning for a manifest that did not fit both caps whole. */
const MANIFEST_TRUNCATED_WARNING = captureOutcome("manifest-truncated").code;

/**
 * The codes persisted with a ready capture: whatever the function reported,
 * plus the truncation warning when this side had to bound the manifest too.
 */
function readyWarnings(result: CaptureSuccessResult, manifest: BoundedManifest): string[] {
  const codes = [...result.warnings];
  if (manifest.truncated && !codes.includes(MANIFEST_TRUNCATED_WARNING)) {
    codes.push(MANIFEST_TRUNCATED_WARNING);
  }
  return codes;
}

/**
 * The layout nonce is drawn into the screenshot and described in the manifest
 * from one stabilized state, so finding it in the bounded manifest is the
 * proof that image and metadata describe the same layout. It is kept ahead of
 * the sampled candidates precisely so truncation cannot lose it.
 */
function manifestMatchesLayout(manifest: BoundedManifest, nonce: string, height: number): boolean {
  const entry = manifest.manifest.elements.find((element) => element.text === nonce);
  if (!entry) return false;
  return (
    entry.rect.width >= 1 &&
    entry.rect.height >= 1 &&
    entry.rect.x >= -1 &&
    entry.rect.y >= -1 &&
    entry.rect.y + entry.rect.height <= height + 1
  );
}

function warningPayload(
  result: CaptureSuccessResult,
  manifest: BoundedManifest,
  codes: string[],
): string {
  return JSON.stringify({
    codes,
    blockedRequests: result.blocked.length,
    manifestBytes: manifest.bytes,
    manifestElements: manifest.manifest.elements.length,
    manifestTruncated: manifest.truncated,
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
      limits: captureFunctionLimits(),
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

  const manifest = boundManifest(result.manifest);
  if (!manifestMatchesLayout(manifest, layoutNonce, result.document.height)) {
    return fail("browserless-provider");
  }
  const warnings = readyWarnings(result, manifest);

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
    warningJson: warningPayload(result, manifest, warnings),
  });
  if (transition === "fenced") {
    // The claim was lost or the row already reached a terminal state, so this
    // object can never be referenced. Delete it rather than orphan it. When
    // the delete itself fails, record bounded cleanup state so the known
    // orphan is never silently dropped; the terminal row is untouched either
    // way.
    const removed = await store.del(stored.value.pathname);
    if (!removed.ok && removed.error !== "not-found") {
      await recordOrphanCleanup(
        db,
        { blobPath: stored.value.pathname, captureId: capture.id },
        now(),
      );
    }
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
      manifestElements: manifest.manifest.elements.length,
      manifestBytes: manifest.bytes,
      manifestTruncated: manifest.truncated,
      warnings,
    },
  };
}

function defaultNonce(): string {
  return `layout_${randomBytes(8).toString("hex")}`;
}
