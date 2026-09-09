// Real-provider proof for the standard Browserless captures (VAL-CAPTURE-003,
// VAL-CAPTURE-004).
//
// Focused tests prove the pipeline against injected providers; nothing about
// device emulation, context isolation, lazy loading, or motion stabilization
// can be proven that way. This suite runs real Browserless executions against
// the repository's versioned controlled fixtures, stores the bytes in the real
// private Blob store, finalizes real Turso rows, and then decodes the returned
// images and compares them.
//
// It runs only when the provider environment *and* the published fixture URLs
// are present, and skips silently otherwise so the CI gate stays green without
// credentials:
//
//   node scripts/publish-capture-fixtures.mjs        # prints the fixture URLs
//   CAPTURE_ECHO_FIXTURE_URL=... CAPTURE_TALL_FIXTURE_URL=... \
//     node --env-file=.env.local node_modules/vitest/vitest.mjs run \
//     test/integration/browserless-capture.integration.test.ts
//
// Every durable row and object carries a unique non-secret run id and is
// deleted in teardown. No credential, provider URL, or provider body is ever
// printed.

import { randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  MOTION_ANCHOR_TOLERANCE_CSS_PX,
  MOTION_MASKED_MAX_DIFF_RATIO,
} from "../../src/lib/boundaries";
import { getCaptureExecutionDeps } from "../../src/lib/server/captures/deps";
import { executeCapture, type ReadyCapture } from "../../src/lib/server/captures/execute";
import { sha256Hex } from "../../src/lib/server/captures/image";
import { retryCapture } from "../../src/lib/server/captures/retry";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import { createDatabase, schema, type Database } from "../../src/lib/server/db/client";
import { createVercelBlobStore, type ScreenshotStore } from "../../src/lib/server/providers/blob";
import { decodePngPixels, type DecodedPixels } from "../helpers/png";

const echoUrl = process.env.CAPTURE_ECHO_FIXTURE_URL;
const tallUrl = process.env.CAPTURE_TALL_FIXTURE_URL;
const ready = Boolean(
  process.env.BROWSERLESS_TOKEN &&
    process.env.BLOB_READ_WRITE_TOKEN &&
    process.env.TURSO_DATABASE_URL &&
    process.env.TURSO_AUTH_TOKEN &&
    echoUrl &&
    tallUrl,
);

const RUN_ID = `capv-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
/** One real execution can use most of the 90 s capture budget. */
const EXECUTION_TIMEOUT_MS = 180_000;

interface Executed {
  ready: ReadyCapture;
  pixels: DecodedPixels;
  manifest: ManifestElement[];
  diagnostics: Diagnostics;
  row: typeof schema.captures.$inferSelect;
}

interface ManifestElement {
  id: string;
  kind: string;
  tag: string;
  text: string;
  hints: { id: string; classes: string[]; alt: string; title: string; testId: string };
  rect: { x: number; y: number; width: number; height: number };
}

interface Diagnostics {
  codes: string[];
  manifestBytes: number;
  scroll: { x: number; y: number; steps: number };
  stabilization: Record<string, number>;
}

let db: Database;
let store: ScreenshotStore;
const storedPaths: string[] = [];

async function seedCapture(label: string, variant: "desktop" | "mobile", url: string) {
  const now = Date.now();
  const scope = `${RUN_ID}-${label}-${variant}`;
  const projectId = `${scope}-project`;
  const pageId = `${scope}-page`;
  const captureId = scope;
  const viewport = variant === "mobile" ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
  await db.insert(schema.projects).values({
    id: projectId,
    publicId: scope,
    title: `${RUN_ID} capture fixture`,
    rootUrl: url,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.pages).values({
    id: pageId,
    projectId,
    requestedUrl: url,
    normalizedUrl: url,
    sortIndex: 0,
    createdAt: now,
  });
  await db.insert(schema.captures).values({
    id: captureId,
    pageId,
    variant,
    attempt: 1,
    status: "capturing",
    idempotencyKey: `${captureId}-key`,
    requestedUrl: url,
    finalUrl: url,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    createdAt: now,
    updatedAt: now,
  });
  return { projectId, pageId, captureId };
}

/** One real Browserless execution, read back from Turso and the Blob store. */
async function execute(label: string, variant: "desktop" | "mobile", url: string): Promise<Executed> {
  const { captureId } = await seedCapture(label, variant, url);
  const result = await executeCapture(db, captureId, getCaptureExecutionDeps());
  if (!result.ok) {
    throw new Error(`execution ${label}/${variant} failed: ${JSON.stringify(result)}`);
  }
  const rows = await db.select().from(schema.captures).where(eq(schema.captures.id, captureId));
  const row = rows[0]!;
  storedPaths.push(row.blobPath!);
  const bytes = await store.get(row.blobPath!);
  if (!bytes.ok) throw new Error(`stored object for ${label}/${variant} is unreadable`);
  const pixels = decodePngPixels(bytes.value);
  // Safe run evidence: identifiers, geometry, and hashes only.
  console.log(
    `[${RUN_ID}] ${label}/${variant} attempt=${row.id} nonce=${result.capture.layoutNonce} ` +
      `viewport=${row.viewportWidth}x${row.viewportHeight}@${row.deviceScaleFactor} ` +
      `document=${row.documentWidth}x${row.documentHeight} decoded=${pixels.width}x${pixels.height} ` +
      `bytes=${row.blobBytes} sha256=${row.imageHash} manifestBytes=${result.capture.manifestBytes} ` +
      `elements=${result.capture.manifestElements} warnings=${result.capture.warnings.join(",") || "none"}`,
  );
  return {
    ready: result.capture,
    pixels,
    manifest: JSON.parse(row.domManifestJson!).elements as ManifestElement[],
    diagnostics: JSON.parse(row.warningJson!) as Diagnostics,
    row,
  };
}

const manifestText = (elements: ManifestElement[]): string =>
  elements.map((element) => element.text).join("\n");

const elementWithHintId = (elements: ManifestElement[], id: string): ManifestElement | undefined =>
  elements.find((element) => element.hints.id === id);

const elementWithText = (elements: ManifestElement[], needle: string): ManifestElement | undefined =>
  elements.find((element) => element.text.includes(needle));

/** Fraction of pixels inside a rect that differ from the page background. */
function inkRatio(pixels: DecodedPixels, rect: ManifestElement["rect"]): number {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(pixels.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(pixels.height, Math.ceil(rect.y + rect.height));
  let inked = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const [r, g, b] = pixels.pixelAt(x, y);
      total += 1;
      // Fixture text is near-black on light backgrounds; anything dark is ink.
      if (r < 120 && g < 120 && b < 120) inked += 1;
    }
  }
  return total === 0 ? 0 : inked / total;
}

interface MaskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ratio of pixels that differ between two images, ignoring masked rects. */
function diffRatio(a: DecodedPixels, b: DecodedPixels, masks: MaskRect[]): number {
  const masked = (x: number, y: number): boolean =>
    masks.some(
      (mask) => x >= mask.x && x < mask.x + mask.width && y >= mask.y && y < mask.y + mask.height,
    );
  let differing = 0;
  let compared = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      if (masked(x, y)) continue;
      compared += 1;
      const p = a.pixelAt(x, y);
      const q = b.pixelAt(x, y);
      if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2] || p[3] !== q[3]) differing += 1;
    }
  }
  return compared === 0 ? 1 : differing / compared;
}

beforeAll(() => {
  if (!ready) return;
  db = createDatabase(process.env)!;
  store = createVercelBlobStore(process.env)!;
});

afterAll(async () => {
  if (!ready) return;
  for (const path of storedPaths) await store.del(path);
  // Match on the page, not the capture id: a retry attempt is created by the
  // application and carries its own generated id.
  await db.delete(schema.captures).where(like(schema.captures.pageId, `${RUN_ID}-%`));
  await db.delete(schema.idempotencyKeys).where(like(schema.idempotencyKeys.key, `${RUN_ID}-%`));
  await db.delete(schema.pages).where(like(schema.pages.id, `${RUN_ID}-%`));
  await db.delete(schema.projects).where(like(schema.projects.id, `${RUN_ID}-%`));
});

describe.skipIf(!ready)("real Browserless device captures (VAL-CAPTURE-003)", () => {
  let desktop: Executed;
  let mobile: Executed;

  beforeAll(async () => {
    // Sequential, so at most one provider job is in flight at a time.
    desktop = await execute("echo", "desktop", echoUrl!);
    mobile = await execute("echo", "mobile", echoUrl!);
  }, EXECUTION_TIMEOUT_MS * 2);

  test("each variant reports its own device geometry from inside the page", () => {
    expect(manifestText(desktop.manifest)).toContain("viewport: 1440x900");
    expect(manifestText(desktop.manifest)).toContain("device-pixel-ratio: 1");
    expect(manifestText(desktop.manifest)).toContain("ua-family: desktop");
    expect(manifestText(desktop.manifest)).toContain("max-touch-points: 0");
    expect(manifestText(desktop.manifest)).toContain("pointer-coarse: false");

    expect(manifestText(mobile.manifest)).toContain("viewport: 390x844");
    expect(manifestText(mobile.manifest)).toContain("device-pixel-ratio: 1");
    expect(manifestText(mobile.manifest)).toContain("ua-family: mobile");
    expect(manifestText(mobile.manifest)).toContain("pointer-coarse: true");
    expect(manifestText(mobile.manifest)).not.toContain("max-touch-points: 0");
  });

  test("decoded pixels match the persisted dimensions at DPR 1", () => {
    for (const executed of [desktop, mobile]) {
      expect(executed.pixels.width).toBe(executed.row.documentWidth);
      expect(executed.pixels.height).toBe(executed.row.documentHeight);
    }
    expect(desktop.pixels.width).toBe(DESKTOP_VIEWPORT.width);
    expect(mobile.pixels.width).toBe(MOBILE_VIEWPORT.width);
  });

  test("the two runs are separate executions with no shared context", () => {
    const nonceOf = (executed: Executed) =>
      elementWithHintId(executed.manifest, "context-nonce")!.text.replace("context-nonce: ", "");
    expect(nonceOf(desktop)).toMatch(/^ctx_[0-9a-f]{16}$/);
    expect(nonceOf(mobile)).toMatch(/^ctx_[0-9a-f]{16}$/);
    expect(nonceOf(desktop)).not.toBe(nonceOf(mobile));
    expect(desktop.ready.layoutNonce).not.toBe(mobile.ready.layoutNonce);

    for (const executed of [desktop, mobile]) {
      const text = manifestText(executed.manifest);
      expect(text).toContain("cookie-sentinel: none");
      expect(text).toContain("local-storage-sentinel: none");
      expect(text).toContain("session-storage-sentinel: none");
      expect(text).not.toContain("LEAKED");
      expect(text).toContain("navigation-count: 1");
      expect(text).toContain("counters: click:0 keydown:0 pointerdown:0 touchstart:0 submit:0 focusin:0");
    }
  });

  test("each ready variant owns its record, private object, hash, and manifest", async () => {
    expect(desktop.row.id).not.toBe(mobile.row.id);
    expect(desktop.row.blobPath).not.toBe(mobile.row.blobPath);
    expect(desktop.row.imageHash).not.toBe(mobile.row.imageHash);

    for (const executed of [desktop, mobile]) {
      expect(executed.row.status).toBe("ready");
      expect(executed.row.errorCode).toBeNull();
      expect(executed.row.errorMessage).toBeNull();
      expect(executed.row.blobContentType).toBe("image/png");
      expect(executed.row.domManifestVersion).toBe(1);
      expect(executed.manifest.length).toBeGreaterThan(5);

      const head = await store.head(executed.row.blobPath!);
      expect(head.ok).toBe(true);
      if (head.ok) {
        expect(head.value.contentType).toBe("image/png");
        expect(head.value.bytes).toBe(executed.row.blobBytes);
      }
      const bytes = await store.get(executed.row.blobPath!);
      expect(bytes.ok).toBe(true);
      if (bytes.ok) expect(sha256Hex(bytes.value)).toBe(executed.row.imageHash);
    }
  });

  test("a failed variant carries its own bounded error and a retry path", async () => {
    const { captureId, pageId } = await seedCapture("failed", "mobile", echoUrl!);
    await applyCaptureTransition(db, {
      captureId,
      from: "capturing",
      to: "failed",
      now: Date.now(),
      errorCode: "navigation-timeout",
      errorMessage: "The page did not finish loading in time.",
    });

    const retry = await retryCapture(db, {
      pageId,
      variant: "mobile",
      idempotencyKey: `${captureId}-retry`,
    });
    expect(retry.ok).toBe(true);

    const attempts = await db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.pageId, pageId));
    expect(attempts).toHaveLength(2);
    const failed = attempts.find((row) => row.attempt === 1)!;
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "navigation-timeout",
      blobPath: null,
      imageHash: null,
    });
    expect(attempts.find((row) => row.attempt === 2)!.status).toBe("pending");

    // The ready siblings from the same run are untouched by that failure.
    const stillReady = await db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.id, desktop.row.id));
    expect(stillReady[0]!.imageHash).toBe(desktop.row.imageHash);
  });
});

describe.skipIf(!ready)("real Browserless motion stabilization (VAL-CAPTURE-004)", () => {
  let first: Executed;
  let second: Executed;

  beforeAll(async () => {
    first = await execute("tall-a", "desktop", tallUrl!);
    second = await execute("tall-b", "desktop", tallUrl!);
  }, EXECUTION_TIMEOUT_MS * 2);

  test("lazy top, middle, and bottom content is present in image and manifest", () => {
    const text = manifestText(first.manifest);
    expect(text).toContain("fixture-version: tall-motion-v1");
    expect(text).toContain("TOP-SENTINEL-VISIBLE");
    expect(text).toContain("MIDDLE-SENTINEL-LOADED");
    expect(text).toContain("BOTTOM-SENTINEL-LOADED");
    expect(text).toContain("FOOTER-SENTINEL-VISIBLE");
    expect(text).toContain("lazy-loads: 2");
    expect(first.pixels.height).toBeGreaterThan(3_000);

    for (const hintId of ["top-sentinel", "middle-sentinel", "bottom-sentinel"]) {
      const element = elementWithHintId(first.manifest, hintId)!;
      expect(element.rect.y + element.rect.height).toBeLessThanOrEqual(first.pixels.height);
      // The sentinel is not merely in the metadata: dark glyphs are painted at
      // its rectangle. A line of text covers a few per cent of a full-width
      // paragraph box, so any measurable ink is the signal.
      expect(inkRatio(first.pixels, element.rect)).toBeGreaterThan(0.002);
    }
  });

  test("the capture never interacts with the page and ends at the top", () => {
    const zeroed = "interactions: click:0 keydown:0 pointerdown:0 touchstart:0 submit:0 focusin:0";
    for (const executed of [first, second]) {
      const text = manifestText(executed.manifest);
      expect(text).toContain(zeroed);
      expect(text).toContain("navigation-count: 1");
      expect(executed.diagnostics.scroll).toMatchObject({ x: 0, y: 0 });
      expect(executed.diagnostics.scroll.steps).toBeGreaterThan(1);
    }
  });

  test("the published motion matrix is applied and unsupported cases warn", () => {
    for (const executed of [first, second]) {
      expect(executed.diagnostics.codes).toContain("motion-unsupported-warn:canvas-js");
      expect(executed.diagnostics.codes).toContain("motion-as-rendered:sticky-parallax");
      expect(executed.diagnostics.codes).toContain("motion-paused:video");
      const stabilization = executed.diagnostics.stabilization;
      // The capture-only stylesheet removes CSS animations outright, so by the
      // time getAnimations() runs only the Web Animations one is left to pause.
      expect(stabilization.animationsPaused).toBeGreaterThanOrEqual(1);
      expect(stabilization.videos).toBe(1);
      expect(stabilization.videosPaused).toBe(1);
      expect(stabilization.animatedImagesFrozen).toBe(1);
      expect(stabilization.canvasCount).toBeGreaterThanOrEqual(1);
      expect(stabilization.stickyCount).toBeGreaterThanOrEqual(1);
    }
  });

  test("stabilization does not move the layout beyond the published tolerance", () => {
    for (const executed of [first, second]) {
      expect(executed.diagnostics.stabilization.anchorsMeasured).toBeGreaterThan(5);
      expect(executed.diagnostics.stabilization.maxAnchorShiftPx).toBeLessThanOrEqual(
        MOTION_ANCHOR_TOLERANCE_CSS_PX,
      );
    }
  });

  test("the animated image is frozen to its first frame", () => {
    // Frame one of the fixture GIF is red (225, 29, 43); frame two is blue.
    const image = first.manifest.find((element) => element.hints.id === "animated-gif")!;
    const x = Math.round(image.rect.x + image.rect.width / 2);
    const y = Math.round(image.rect.y + image.rect.height / 2);
    const [r, g, b] = first.pixels.pixelAt(x, y);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeLessThan(90);
    expect(b).toBeLessThan(90);
  });

  test("two captures of the fixture agree outside the published masked region", () => {
    expect(second.pixels.width).toBe(first.pixels.width);
    expect(second.pixels.height).toBe(first.pixels.height);

    const volatileBand = elementWithHintId(first.manifest, "volatile")!.rect;
    const nonceOverlay = elementWithText(first.manifest, first.ready.layoutNonce)!.rect;
    const ratio = diffRatio(first.pixels, second.pixels, [
      { ...volatileBand },
      // The overlay is drawn by capture itself and carries the run's nonce.
      { x: nonceOverlay.x, y: nonceOverlay.y, width: nonceOverlay.width + 8, height: nonceOverlay.height + 8 },
    ]);
    console.log(
      `[${RUN_ID}] tall masked-diff ratio=${ratio} threshold=${MOTION_MASKED_MAX_DIFF_RATIO} ` +
        `anchorShiftPx=${first.diagnostics.stabilization.maxAnchorShiftPx}/${second.diagnostics.stabilization.maxAnchorShiftPx} ` +
        `scrollSteps=${first.diagnostics.scroll.steps}`,
    );
    expect(ratio).toBeLessThanOrEqual(MOTION_MASKED_MAX_DIFF_RATIO);
  });
});
