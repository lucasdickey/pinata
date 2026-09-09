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
const manifestUrl = process.env.CAPTURE_MANIFEST_FIXTURE_URL;
const linksUrl = process.env.CAPTURE_LINKS_FIXTURE_URL;
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
  accessibleName: string;
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

describe.skipIf(!ready || !manifestUrl)(
  "real Browserless DOM manifest (VAL-CAPTURE-005, VAL-CAPTURE-006)",
  () => {
    let desktop: Executed;
    let mobile: Executed;

    beforeAll(async () => {
      desktop = await execute("manifest", "desktop", manifestUrl!);
      mobile = await execute("manifest", "mobile", manifestUrl!);
    }, EXECUTION_TIMEOUT_MS * 2);

    test("the manifest and the screenshot describe one stabilized layout", () => {
      for (const executed of [desktop, mobile]) {
        const elements = executed.manifest;
        // The nonce drawn into the image is the nonce described here.
        const nonce = elementWithText(elements, executed.ready.layoutNonce)!;
        expect(nonce.rect.x).toBeLessThanOrEqual(1);
        expect(nonce.rect.y).toBeLessThanOrEqual(1);
        expect(inkRatio(executed.pixels, nonce.rect)).toBeGreaterThan(0.002);

        // Known landmark rectangles land on painted glyphs in the decoded
        // image: document-space coordinates and pixels agree at DPR 1.
        const landmarks = ["MANIFEST-TOP-LANDMARK", "MANIFEST-MIDDLE-LANDMARK", "MANIFEST-BOTTOM-LANDMARK"]
          .map((needle) => elementWithText(elements, needle)!);
        for (const landmark of landmarks) {
          expect(landmark.rect.y + landmark.rect.height).toBeLessThanOrEqual(executed.pixels.height);
          expect(inkRatio(executed.pixels, landmark.rect)).toBeGreaterThan(0.002);
        }
        expect(landmarks[0]!.rect.y).toBeLessThan(landmarks[1]!.rect.y);
        expect(landmarks[1]!.rect.y).toBeLessThan(landmarks[2]!.rect.y);

        // The exact persisted JSON obeys both published caps.
        expect(executed.row.domManifestVersion).toBe(1);
        expect(elements.length).toBeLessThanOrEqual(500);
        expect(executed.ready.manifestBytes).toBeLessThanOrEqual(262_144);
        expect(Buffer.byteLength(executed.row.domManifestJson!, "utf8")).toBe(
          executed.ready.manifestBytes,
        );
        expect(executed.ready.manifestTruncated).toBe(false);
      }
    });

    test("hidden, closed, clipped, and sensitive sources are absent; siblings remain", () => {
      for (const executed of [desktop, mobile]) {
        // Every forbidden source carries a SENTINEL- marker; none may appear
        // anywhere in the exact persisted JSON.
        expect(executed.row.domManifestJson!).not.toContain("SENTINEL-");

        const text =
          manifestText(executed.manifest) +
          "\n" +
          executed.manifest.map((element) => element.accessibleName).join("\n");
        for (const sibling of [
          "MANIFEST-TOP-LANDMARK",
          "MANIFEST-VISIBLE-SIBLING-ONE",
          "MANIFEST-MENU-SUMMARY",
          "MANIFEST-FORM-BUTTON",
          "MANIFEST-LINK visible docs text",
          "MANIFEST-IMAGE-ALT",
          "MANIFEST-SHADOW-HOST",
          "MANIFEST-MIDDLE-LANDMARK",
          "MANIFEST-BOTTOM-LANDMARK",
        ]) {
          expect(text, sibling).toContain(sibling);
        }

        // A hidden descendant does not ride out inside its visible parent.
        expect(elementWithHintId(executed.manifest, "hidden-rider")!.text).toBe(
          "Visible lead-in visible tail",
        );
        // The closed menu keeps its summary and nothing else.
        expect(elementWithHintId(executed.manifest, "menu")).toBeDefined();
        // Capture never interacted with the page.
        expect(text).toContain("interactions: click:0 keydown:0 pointerdown:0 submit:0");
      }
    });

    test("hostile visible text stays bounded and inert", () => {
      for (const executed of [desktop, mobile]) {
        const hostile = elementWithHintId(executed.manifest, "hostile")!;
        expect(hostile.text).toContain("MANIFEST-HOSTILE");
        expect(hostile.text).not.toMatch(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/);
        expect(hostile.text).not.toMatch(/\u0301{9,}/);
        expect(executed.row.domManifestJson!).not.toMatch(/[\u2028\u2029]/);
        expect(executed.row.domManifestJson!).not.toContain("\\u2028");
      }
    });
  },
);

describe.skipIf(!ready || !linksUrl)(
  "a link-laden page creates no pages or attempts beyond the submitted URL (VAL-PROJECT-003)",
  () => {
    let desktop: Executed;

    beforeAll(async () => {
      desktop = await execute("links", "desktop", linksUrl!);
    }, EXECUTION_TIMEOUT_MS);

    test("the capture completes and ordinary public subresources remain available", () => {
      const text = manifestText(desktop.manifest);
      expect(text).toContain("fixture-version: links-v1");
      expect(text).toContain("LINKS-FIXTURE-TOP");
      expect(text).toContain("LINKS-FIXTURE-BOTTOM");
      // The stylesheet and image subresources loaded; a network policy that
      // blocked ordinary public subresources would leave these pending.
      expect(text).toContain("subresource-css: loaded");
      expect(text).toContain("subresource-image: loaded");
      // The capture never interacted with the page.
      expect(text).toContain("counters: click:0 keydown:0 pointerdown:0 touchstart:0 submit:0");
      expect(text).toContain("navigation-count: 1");
    });

    test("linked URLs never became pages, attempts, or captured content", async () => {
      // Every linked target — canonical, alternate, sitemap, JSON-LD, iframe,
      // inline anchor, form action, and the delayed script-inserted anchor —
      // names a distinct host so any leaked attempt is attributable.
      const linkedHosts = [
        "canonical.example",
        "feed.example",
        "sitemap.example",
        "jsonld.example",
        "framed.example",
        "inline.example",
        "formaction.example",
        "script-inserted.example",
      ];

      // The run's project holds exactly the one submitted page; no page row
      // exists for any linked target.
      const pages = await db
        .select()
        .from(schema.pages)
        .where(like(schema.pages.id, `${RUN_ID}-links-%`));
      expect(pages).toHaveLength(1);
      expect(pages[0]!.normalizedUrl).toBe(linksUrl);
      for (const host of linkedHosts) {
        expect(pages[0]!.normalizedUrl).not.toContain(host);
      }

      // Exactly the two initial attempts (desktop + mobile) exist for that
      // page, and every attempt row in this run names the submitted URL only.
      const attempts = await db
        .select()
        .from(schema.captures)
        .where(like(schema.captures.pageId, `${RUN_ID}-links-%`));
      expect(attempts).toHaveLength(2);
      for (const attempt of attempts) {
        expect(attempt.requestedUrl).toBe(linksUrl);
        if (attempt.finalUrl !== null) expect(attempt.finalUrl).toBe(linksUrl);
      }

      // The persisted manifest names none of the linked hosts: nothing
      // followed them. The script-inserted anchor connected 400 ms into the
      // page life, inside the capture window; its href target is absent.
      const storedJson = desktop.row.domManifestJson!;
      for (const host of linkedHosts) {
        expect(storedJson).not.toContain(host);
      }
    });

    test("the delayed script-inserted anchor never gained a sibling", async () => {
      // Re-reading through a fresh handle after the run, the project still
      // contains exactly one page and two attempts for it. A crawler that
      // woke late would have left rows behind; none exist.
      const fresh = createDatabase(process.env)!;
      const pages = await fresh
        .select()
        .from(schema.pages)
        .where(like(schema.pages.id, `${RUN_ID}-links-%`));
      const attempts = await fresh
        .select()
        .from(schema.captures)
        .where(like(schema.captures.pageId, `${RUN_ID}-links-%`));
      expect(pages).toHaveLength(1);
      expect(attempts).toHaveLength(2);
      expect(attempts.map((row) => row.variant).sort()).toEqual(["desktop", "mobile"]);
    });
  },
);

describe.skipIf(!ready || !echoUrl)(
  "deterministic partial failure keeps successful siblings usable (VAL-PROJECT-005)",
  () => {
    // The version-pinned deterministic failure fixtures: a URL that resolves
    // nowhere public fails admission identically on every run, so it is the
    // URL-level failure; failing exactly one variant row of a two-variant
    // page is the Desktop-only / Mobile-only failure. Successful siblings
    // come from real provider executions against the echo fixture.

    test("a URL-level failure fails both variants while sibling pages stay ready", async () => {
      const now = Date.now();
      const scope = `${RUN_ID}-urlfail`;
      const projectId = `${scope}-project`;
      // A syntactically valid public HTTPS name under example.com that no
      // DNS zone serves: it fails admission deterministically on every run,
      // for every variant, as `dns-failed`.
      const failureUrl = "https://capture-fixture-unreachable.example.com/";
      await db.insert(schema.projects).values({
        id: projectId,
        publicId: scope,
        title: `${RUN_ID} partial failure`,
        rootUrl: echoUrl!,
        createdAt: now,
        updatedAt: now,
      });

      // Page one succeeds on both variants through the real provider. The
      // `execute` helper seeds one project+page per call, so this page simply
      // gathers their rows by moving them onto one page id.
      const okPageId = `${scope}-page-ok`;
      await db.insert(schema.pages).values({
        id: okPageId,
        projectId,
        requestedUrl: echoUrl!,
        normalizedUrl: echoUrl!,
        sortIndex: 0,
        createdAt: now,
      });
      const okDesktop = await execute(`${scope}-ok`, "desktop", echoUrl!);
      const okMobile = await execute(`${scope}-ok`, "mobile", echoUrl!);
      for (const executed of [okDesktop, okMobile]) {
        await db
          .update(schema.captures)
          .set({ pageId: okPageId })
          .where(eq(schema.captures.id, executed.row.id));
      }

      // Page two targets the deterministic failure URL on both variants.
      const badPageId = `${scope}-page-bad`;
      await db.insert(schema.pages).values({
        id: badPageId,
        projectId,
        requestedUrl: failureUrl,
        normalizedUrl: failureUrl,
        sortIndex: 1,
        createdAt: now,
      });
      const badIds: string[] = [];
      for (const variant of ["desktop", "mobile"] as const) {
        const viewport = variant === "mobile" ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
        const id = `${scope}-bad-${variant}`;
        await db.insert(schema.captures).values({
          id,
          pageId: badPageId,
          variant,
          attempt: 1,
          status: "pending",
          idempotencyKey: `${id}-key`,
          requestedUrl: failureUrl,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
          createdAt: now,
          updatedAt: now,
        });
        badIds.push(id);
      }

      // Both variants of the unreachable URL fail admission with the same
      // bounded outcome; no provider job or object is ever created for them.
      const { dispatchCapture } = await import("../../src/lib/server/captures/dispatch");
      const { getAdmissionDeps } = await import("../../src/lib/server/captures/deps");
      for (const id of badIds) {
        const result = await dispatchCapture(db, { captureId: id }, getAdmissionDeps());
        expect(result).toMatchObject({ ok: false, error: "rejected" });
        if (!result.ok && result.error === "rejected") {
          expect(result.outcome).toBe("dns-failed");
        }
      }

      const { readProjectHierarchy } = await import(
        "../../src/lib/server/projects/hierarchy"
      );
      const hierarchy = await readProjectHierarchy(db, scope, Date.now());
      expect(hierarchy).not.toBeNull();
      expect(hierarchy!.pages).toHaveLength(2);
      // Successful siblings: usable, ordered, untouched.
      expect(hierarchy!.pages[0]!.devices[0]!.usable).toBe(true);
      expect(hierarchy!.pages[0]!.devices[1]!.usable).toBe(true);
      // Failed URL: both variants failed with the same retryable outcome.
      expect(hierarchy!.pages[1]!.devices[0]!.latest?.state).toBe("failed");
      expect(hierarchy!.pages[1]!.devices[0]!.latest?.errorCode).toBe("dns-failed");
      expect(hierarchy!.pages[1]!.devices[1]!.latest?.state).toBe("failed");
      expect(hierarchy!.pages[1]!.devices[1]!.latest?.errorCode).toBe("dns-failed");
      expect(hierarchy!.counts).toMatchObject({ ready: 2, failed: 2 });
      expect(okDesktop.ready.imageHash).toBeTruthy();
      expect(okMobile.ready.imageHash).toBeTruthy();
    }, EXECUTION_TIMEOUT_MS * 2);

    test("a Desktop-only failure keeps the Mobile sibling selected and retryable", async () => {
      const scope = `${RUN_ID}-desktop-fail`;
      // The mobile sibling succeeds through the real provider first.
      const mobile = await execute(scope, "mobile", echoUrl!);
      // The desktop attempt fails terminally on the same page.
      const desktopId = `${scope}-desktop`;
      const now = Date.now();
      await db.insert(schema.captures).values({
        id: desktopId,
        pageId: mobile.row.pageId,
        variant: "desktop",
        attempt: 1,
        status: "pending",
        idempotencyKey: `${desktopId}-key`,
        requestedUrl: echoUrl!,
        viewportWidth: DESKTOP_VIEWPORT.width,
        viewportHeight: DESKTOP_VIEWPORT.height,
        deviceScaleFactor: DESKTOP_VIEWPORT.deviceScaleFactor,
        createdAt: now,
        updatedAt: now,
      });
      await applyCaptureTransition(db, {
        captureId: desktopId,
        from: "pending",
        to: "failed",
        errorCode: "navigation-timeout",
        errorMessage: "The page did not finish navigating in time.",
        now,
      });

      const attempts = await db
        .select()
        .from(schema.captures)
        .where(eq(schema.captures.pageId, mobile.row.pageId));
      const desktopRow = attempts.find((row) => row.variant === "desktop")!;
      expect(desktopRow).toMatchObject({ status: "failed", errorCode: "navigation-timeout" });
      // Retry is enabled only for the terminal desktop attempt, and the same
      // key creates exactly one new attempt.
      const retry = await retryCapture(db, {
        pageId: mobile.row.pageId,
        variant: "desktop",
        idempotencyKey: `${scope}-retry`,
      });
      expect(retry.ok).toBe(true);
      if (retry.ok) expect(retry.attempt.attempt).toBe(2);
      const replay = await retryCapture(db, {
        pageId: mobile.row.pageId,
        variant: "desktop",
        idempotencyKey: `${scope}-retry`,
      });
      expect(replay).toMatchObject({ ok: true, created: false });
      // The ready mobile sibling was never resubmitted.
      const mobileAttempts = attempts.filter((row) => row.variant === "mobile");
      expect(mobileAttempts).toHaveLength(1);
      expect(mobileAttempts[0]!.status).toBe("ready");
    }, EXECUTION_TIMEOUT_MS);

    test("a Mobile-only failure keeps the Desktop sibling selected and retryable", async () => {
      const scope = `${RUN_ID}-mobile-fail`;
      const desktop = await execute(scope, "desktop", echoUrl!);
      const mobileId = `${scope}-mobile`;
      const now = Date.now();
      await db.insert(schema.captures).values({
        id: mobileId,
        pageId: desktop.row.pageId,
        variant: "mobile",
        attempt: 1,
        status: "pending",
        idempotencyKey: `${mobileId}-key`,
        requestedUrl: echoUrl!,
        viewportWidth: MOBILE_VIEWPORT.width,
        viewportHeight: MOBILE_VIEWPORT.height,
        deviceScaleFactor: MOBILE_VIEWPORT.deviceScaleFactor,
        createdAt: now,
        updatedAt: now,
      });
      await applyCaptureTransition(db, {
        captureId: mobileId,
        from: "pending",
        to: "failed",
        errorCode: "total-timeout",
        errorMessage: "The capture exceeded its total time budget.",
        now,
      });

      const attempts = await db
        .select()
        .from(schema.captures)
        .where(eq(schema.captures.pageId, desktop.row.pageId));
      const mobileRow = attempts.find((row) => row.variant === "mobile")!;
      expect(mobileRow).toMatchObject({ status: "failed", errorCode: "total-timeout" });
      const retry = await retryCapture(db, {
        pageId: desktop.row.pageId,
        variant: "mobile",
        idempotencyKey: `${scope}-retry`,
      });
      expect(retry.ok).toBe(true);
      if (retry.ok) expect(retry.attempt.attempt).toBe(2);
      // The ready desktop sibling was never resubmitted.
      const desktopAttempts = attempts.filter((row) => row.variant === "desktop");
      expect(desktopAttempts).toHaveLength(1);
      expect(desktopAttempts[0]!.status).toBe("ready");
    }, EXECUTION_TIMEOUT_MS);
  },
);
