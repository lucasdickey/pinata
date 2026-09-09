// Real-provider proof for remote Browserless network safety (VAL-CAPTURE-013).
//
// Focused tests prove the guard source and the admission chain; they cannot
// prove what the provider's own network does when a public-shaped name
// resolves private a moment after admission. This suite runs real Browserless
// executions against the repository's version-pinned remote-network fixtures
// and against seeded attempts that model DNS changing after admission, then
// scans the exact persisted manifest JSON and the decoded screenshot pixels
// for the fixture's private-response sentinels.
//
// Two fixtures split the matrix by observed provider behavior (2026-09-09):
//
// - remote-network-v1 (expected READY): every vector aimed at RFC1918
//   literals (guard-aborted before any network use) and at public-shaped
//   names whose DNS answers are private — static nip.io names and the live
//   alternating rbndr.us name — plus the fixture host's own redirect routes
//   into private-resolving names. The provider refuses these at the network
//   layer (fast refuse or silent drop) without harming the session, so the
//   capture must complete ready with every probe blocked and the ordinary
//   public subresources loaded.
// - remote-network-hard-v1 (expected BOUNDED SAFE FAILURE): literal loopback,
//   link-local, metadata, and IPv6-local requests. The provider destroys the
//   browser session outright when a page attempts these, so the proof is
//   that no ready image, manifest, or stored object can ever exist.
//
// It runs only when the provider environment and the published fixture URLs
// are present, and skips silently otherwise so the CI gate stays green:
//
//   eval "$(npm run fixtures:publish --silent -- --export)"
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run \
//     test/integration/browserless-network-safety.integration.test.ts
//
// Every durable row and object carries a unique non-secret run id and is
// deleted in teardown. No credential, provider URL, resolved address, or
// provider body is ever printed; the rebinding evidence logs verdict counts
// only (the answers are already encoded in the public test hostname).

import { randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DESKTOP_VIEWPORT,
  MAX_PUBLIC_MESSAGE_BYTES,
  TOTAL_CAPTURE_TIMEOUT_MS,
} from "../../src/lib/boundaries";
import { getAdmissionDeps, getCaptureExecutionDeps } from "../../src/lib/server/captures/deps";
import { dispatchCapture } from "../../src/lib/server/captures/dispatch";
import { createNodeDnsResolver, resolveHostPublicly } from "../../src/lib/server/captures/dns";
import { executeCapture, type ReadyCapture } from "../../src/lib/server/captures/execute";
import { createDatabase, schema, type Database } from "../../src/lib/server/db/client";
import { createVercelBlobStore, type ScreenshotStore } from "../../src/lib/server/providers/blob";
import { decodePngPixels, type DecodedPixels } from "../helpers/png";

const networkUrl = process.env.CAPTURE_NETWORK_FIXTURE_URL;
const networkHardUrl = process.env.CAPTURE_NETWORK_HARD_FIXTURE_URL;
const ready = Boolean(
  process.env.BROWSERLESS_TOKEN &&
    process.env.BLOB_READ_WRITE_TOKEN &&
    process.env.TURSO_DATABASE_URL &&
    process.env.TURSO_AUTH_TOKEN &&
    networkUrl &&
    networkHardUrl,
);

const RUN_ID = `capv-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
/** One real execution can use most of the 90 s capture budget. */
const EXECUTION_TIMEOUT_MS = 180_000;

/** The fixture's runtime-assembled leak marker. Keep in one place. */
const LEAK_SENTINEL = "PRIVLEAK";
/**
 * Strings that may never appear in a persisted artifact: every private
 * destination the fixture probes, the rebinding hostnames, and the shape of
 * a cloud-metadata response. They live only in the fixture's probe script,
 * so finding one here is always a real detection.
 */
const PRIVATE_SENTINELS = [
  LEAK_SENTINEL,
  "169.254.169.254",
  "169.254.1.10",
  "127.0.0.1",
  "192.168.",
  "10.0.0.1",
  "[::1]",
  "fd00::",
  "nip.io",
  "rbndr.us",
  "instance-id",
  "ami-id",
  "security-credentials",
  "computeMetadata",
];

/** Pass/fail probes: each must end in exactly this safe status. */
const BLOCKED_PROBES = [
  "fetch-rfc1918",
  "fetch-private10",
  "fetch-rebind-loopback",
  "fetch-rebind-meta",
  "fetch-rebind-live",
  "fetch-redirect-meta",
  "fetch-redirect-loopback",
  "image-rfc1918",
  "image-rebind-meta",
  "ws-loopback",
  "ws-rebind",
  "worker-rebind-meta",
];
/** Frame probes are triggers: cross-origin internals are unreadable by
 * construction, so their status records the observed load event. */
const FRAME_PROBES = ["frame-rfc1918", "frame-rebind-meta"];

/** Seeded attempts that model DNS answering private only after admission. */
const REBIND_TARGETS = [
  "https://127.0.0.1.nip.io/",
  "https://169.254.169.254.nip.io/",
  "https://10.0.0.1.nip.io/",
];
/** Bounded safe failure outcomes for a private-resolving target. */
const SAFE_FAILURE_OUTCOMES = new Set([
  "navigation-timeout",
  "total-timeout",
  "browserless-provider",
  "unsafe-redirect",
]);

interface ManifestElement {
  id: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

interface NetworkDiagnostics {
  codes: string[];
  blockedRequests: number;
  manifestBytes: number;
  manifestElements: number;
}

let db: Database;
let store: ScreenshotStore;
const storedPaths: string[] = [];

async function seedCapture(
  label: string,
  url: string,
  status: "pending" | "capturing" = "capturing",
) {
  const now = Date.now();
  const scope = `${RUN_ID}-${label}`;
  const projectId = `${scope}-project`;
  const pageId = `${scope}-page`;
  await db.insert(schema.projects).values({
    id: projectId,
    publicId: scope,
    title: `${RUN_ID} network safety`,
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
    id: scope,
    pageId,
    variant: "desktop",
    attempt: 1,
    status,
    idempotencyKey: `${scope}-key`,
    requestedUrl: url,
    finalUrl: url,
    viewportWidth: DESKTOP_VIEWPORT.width,
    viewportHeight: DESKTOP_VIEWPORT.height,
    deviceScaleFactor: DESKTOP_VIEWPORT.deviceScaleFactor,
    createdAt: now,
    updatedAt: now,
  });
  return { captureId: scope };
}

interface Executed {
  ready: ReadyCapture;
  pixels: DecodedPixels;
  manifestJson: string;
  elements: ManifestElement[];
  diagnostics: NetworkDiagnostics;
  elapsedMs: number;
  row: typeof schema.captures.$inferSelect;
}

/** One real execution of the network fixture, read back from Turso + Blob. */
async function executeFixture(): Promise<Executed> {
  const { captureId } = await seedCapture("network", networkUrl!);
  const startedAt = Date.now();
  const result = await executeCapture(db, captureId, getCaptureExecutionDeps());
  const elapsedMs = Date.now() - startedAt;
  if (!result.ok) {
    throw new Error(`network fixture execution failed: ${JSON.stringify(result)}`);
  }
  const row = (
    await db.select().from(schema.captures).where(eq(schema.captures.id, captureId))
  )[0]!;
  storedPaths.push(row.blobPath!);
  const bytes = await store.get(row.blobPath!);
  if (!bytes.ok) throw new Error("stored fixture object is unreadable");
  const pixels = decodePngPixels(bytes.value);
  const diagnostics = JSON.parse(row.warningJson!) as NetworkDiagnostics;
  // Safe run evidence: identifiers, geometry, hashes, and counts only.
  console.log(
    `[${RUN_ID}] network-fixture attempt=${row.id} nonce=${result.capture.layoutNonce} ` +
      `document=${row.documentWidth}x${row.documentHeight} decoded=${pixels.width}x${pixels.height} ` +
      `bytes=${row.blobBytes} sha256=${row.imageHash} elapsedMs=${elapsedMs} ` +
      `blockedRequests=${diagnostics.blockedRequests} ` +
      `warnings=${result.capture.warnings.join(",") || "none"}`,
  );
  return {
    ready: result.capture,
    pixels,
    manifestJson: row.domManifestJson!,
    elements: (JSON.parse(row.domManifestJson!) as { elements: ManifestElement[] }).elements,
    diagnostics,
    elapsedMs,
    row,
  };
}

/** Count of pure-magenta pixels: the fixture paints it only on a leak. */
function leakPixels(pixels: DecodedPixels): number {
  let found = 0;
  const data = pixels.data;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) found += 1;
  }
  return found;
}

beforeAll(() => {
  if (!ready) return;
  db = createDatabase(process.env)!;
  store = createVercelBlobStore(process.env)!;
});

afterAll(async () => {
  if (!ready) return;
  for (const path of storedPaths) await store.del(path);
  // Match on the page, not the capture id: retries carry generated ids.
  await db.delete(schema.captures).where(like(schema.captures.pageId, `${RUN_ID}-%`));
  await db.delete(schema.captureLeases).where(like(schema.captureLeases.captureId, `${RUN_ID}-%`));
  await db.delete(schema.idempotencyKeys).where(like(schema.idempotencyKeys.key, `${RUN_ID}-%`));
  await db.delete(schema.pages).where(like(schema.pages.id, `${RUN_ID}-%`));
  await db.delete(schema.projects).where(like(schema.projects.id, `${RUN_ID}-%`));
});

describe.skipIf(!ready)("remote Browserless network safety (VAL-CAPTURE-013)", () => {
  let fixture: Executed;

  beforeAll(async () => {
    fixture = await executeFixture();
  }, EXECUTION_TIMEOUT_MS);

  test("the probe page completes ready inside the total deadline", () => {
    expect(fixture.row.status).toBe("ready");
    expect(fixture.row.errorCode).toBeNull();
    expect(fixture.elapsedMs).toBeLessThan(TOTAL_CAPTURE_TIMEOUT_MS + 30_000);
    const text = fixture.elements.map((element) => element.text).join("\n");
    expect(text).toContain("fixture-version: remote-network-v1");
    expect(text).toContain("NETWORK-FIXTURE-TOP");
    expect(text).toContain("NETWORK-FIXTURE-BOTTOM");
    expect(text).toContain("probes-settled: 14/14");
    // The capture never interacted with the attacking page.
    expect(text).toContain("counters: click:0 keydown:0 pointerdown:0 touchstart:0 submit:0 focusin:0");
    expect(text).toContain("navigation-count: 1");
  });

  test("every private fetch, image, WebSocket, and worker probe was refused", () => {
    const text = fixture.elements.map((element) => element.text).join("\n");
    expect(text).not.toContain(": pending");
    for (const probe of BLOCKED_PROBES) {
      expect(text, probe).toContain(`probe-${probe}: blocked`);
    }
    for (const probe of FRAME_PROBES) {
      expect(text, probe).toMatch(new RegExp(`probe-${probe}: attempted load=(yes|no|timeout)`));
    }
    // The in-function guard's refusal record rode back with the result: the
    // literal RFC1918 subresource destinations (two fetches, one image, one
    // frame) are aborted before any network use, and the count is bounded.
    expect(fixture.diagnostics.blockedRequests).toBeGreaterThanOrEqual(4);
    expect(fixture.diagnostics.blockedRequests).toBeLessThanOrEqual(32);
  });

  test("no private sentinel entered the persisted manifest", () => {
    for (const sentinel of PRIVATE_SENTINELS) {
      expect(fixture.manifestJson, sentinel).not.toContain(sentinel);
    }
  });

  test("no private sentinel entered the decoded screenshot", () => {
    // The fixture paints pure magenta iff a private destination answered, so
    // a whole-image scan for that colour is a whole-image sentinel scan.
    expect(leakPixels(fixture.pixels)).toBe(0);
    // The nonce is painted and described from the same stabilized layout.
    const nonce = fixture.elements.find((element) => element.text === fixture.ready.layoutNonce);
    expect(nonce).toBeDefined();
  });

  test("ordinary public subresources remained available", () => {
    const text = fixture.elements.map((element) => element.text).join("\n");
    expect(text).toContain("public-image: loaded 64x64");
    expect(text).toContain("public-fetch: 200");
    expect(text).toContain("public-frame: loaded-readable");
  });

  test(
    "DNS answering private after admission still fails safe at the provider",
    async () => {
      // The live rebinding observation: one public test name whose answers
      // alternate between a public and a loopback address. Verdict counts
      // only — the answers are already encoded in the name itself.
      const resolver = createNodeDnsResolver();
      let publicVerdicts = 0;
      let nonPublicVerdicts = 0;
      for (let round = 0; round < 8; round += 1) {
        const verdict = await resolveHostPublicly("7f000001.08080808.rbndr.us", resolver);
        if (verdict.ok) publicVerdicts += 1;
        else if (!verdict.ok && verdict.reason === "non-public") nonPublicVerdicts += 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      console.log(
        `[${RUN_ID}] rebind evidence: public verdicts=${publicVerdicts} ` +
          `non-public verdicts=${nonPublicVerdicts} (same hostname, live DNS)`,
      );
      // The third-party service is evidence, not an assertion: it must at
      // least answer, but the mix is its own behavior.
      expect(publicVerdicts + nonPublicVerdicts).toBeGreaterThan(0);

      for (const [index, target] of REBIND_TARGETS.entries()) {
        // When admission can see the private answer it refuses before any
        // provider work: the row fails with the bounded DNS outcome.
        const { captureId: admittedId } = await seedCapture(`rebind-admit-${index}`, target, "pending");
        const admission = await dispatchCapture(db, { captureId: admittedId }, getAdmissionDeps());
        expect(admission).toMatchObject({ ok: false, error: "rejected" });
        if (!admission.ok && admission.error === "rejected") {
          expect(admission.outcome).toBe("dns-failed");
        }

        // When admission saw a public answer and DNS flipped afterwards, the
        // provider-side defence is all that is left: model that window with
        // an already-claimed row and prove the execution still ends in a
        // bounded safe failure with no stored object and no leaked address.
        const { captureId } = await seedCapture(`rebind-run-${index}`, target);
        const startedAt = Date.now();
        const result = await executeCapture(db, captureId, getCaptureExecutionDeps());
        const elapsedMs = Date.now() - startedAt;
        // A ready capture of a private-resolving name is an unsafe-network
        // ambiguity: fail loudly rather than bless it.
        if (result.ok) {
          throw new Error(`UNSAFE: private-resolving target produced a ready capture: ${captureId}`);
        }
        expect(result).toMatchObject({ ok: false });
        if (!result.ok && "outcome" in result) {
          expect(SAFE_FAILURE_OUTCOMES.has(result.outcome)).toBe(true);
        }
        expect(elapsedMs).toBeLessThan(TOTAL_CAPTURE_TIMEOUT_MS + 30_000);

        const row = (
          await db.select().from(schema.captures).where(eq(schema.captures.id, captureId))
        )[0]!;
        expect(row.status).toBe("failed");
        expect(row.blobPath).toBeNull();
        expect(row.imageHash).toBeNull();
        expect(row.domManifestJson).toBeNull();
        expect(row.errorCode).toBeTruthy();
        expect(row.errorMessage).toBeTruthy();
        expect(Buffer.byteLength(row.errorMessage!, "utf8")).toBeLessThanOrEqual(
          MAX_PUBLIC_MESSAGE_BYTES,
        );
        for (const sentinel of PRIVATE_SENTINELS) {
          expect(row.errorMessage!, sentinel).not.toContain(sentinel);
        }
        console.log(
          `[${RUN_ID}] rebind probe ${index} attempt=${captureId} ` +
            `outcome=${row.errorCode} elapsedMs=${elapsedMs}`,
        );
      }
    },
    EXECUTION_TIMEOUT_MS * 3,
  );

  test(
    "literal loopback, link-local, metadata, and IPv6-local attempts end in a bounded safe failure with no artifact",
    async () => {
      // The hard fixture attacks the destinations the provider treats as
      // fatal to the browsing session. The proof is not a status word on a
      // rendered page — it is that no image, manifest, or stored object can
      // exist afterwards, and the attempt ends inside the total deadline.
      const { captureId } = await seedCapture("network-hard", networkHardUrl!);
      const startedAt = Date.now();
      const result = await executeCapture(db, captureId, getCaptureExecutionDeps());
      const elapsedMs = Date.now() - startedAt;
      // A ready capture of this page would mean literal metadata traffic
      // rendered into a stored artifact: fail loudly rather than bless it.
      if (result.ok) {
        throw new Error(`UNSAFE: hard network fixture produced a ready capture: ${captureId}`);
      }
      expect(result).toMatchObject({ ok: false });
      if (!result.ok && "outcome" in result) {
        expect(SAFE_FAILURE_OUTCOMES.has(result.outcome)).toBe(true);
      }
      expect(elapsedMs).toBeLessThan(TOTAL_CAPTURE_TIMEOUT_MS + 30_000);

      const row = (
        await db.select().from(schema.captures).where(eq(schema.captures.id, captureId))
      )[0]!;
      expect(row.status).toBe("failed");
      expect(row.blobPath).toBeNull();
      expect(row.imageHash).toBeNull();
      expect(row.domManifestJson).toBeNull();
      expect(row.errorCode).toBeTruthy();
      expect(row.errorMessage).toBeTruthy();
      expect(Buffer.byteLength(row.errorMessage!, "utf8")).toBeLessThanOrEqual(
        MAX_PUBLIC_MESSAGE_BYTES,
      );
      for (const sentinel of PRIVATE_SENTINELS) {
        expect(row.errorMessage!, sentinel).not.toContain(sentinel);
      }
      console.log(
        `[${RUN_ID}] network-hard attempt=${captureId} ` +
          `outcome=${row.errorCode} elapsedMs=${elapsedMs}`,
      );
    },
    EXECUTION_TIMEOUT_MS * 2,
  );
});
