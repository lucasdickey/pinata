// End-to-end contract for plane isolation (VAL-CANVAS-004): pins and their
// chosen element snapshots belong to exactly one capture. Distinguishable
// comments and metadata choices are written to a RUN-SCOPED project's
// Desktop capture, its Mobile sibling, and a fresh recapture (a new
// attempt), then verified — before and after reload — to render only on
// their own plane: Desktop v1 (the old capture) shows its pin, Desktop v2
// (the recapture) shows only its own, Mobile shows only its own.
//
// The project is run-scoped by design: writing to the seeded Chickpea
// planes would race pin-lifecycle's numbering assertions under the
// full-gate's two workers (the 2026-09-10 contention failure). Everything
// this suite creates — project, page, three real captures, pins, Blob
// objects — carries the run id and is deleted, and verified absent, by the
// Playwright global teardown (registered in afterAll, executed after every
// worker's last page has closed — see e2e/run-cleanup.ts). Gates on the
// full local configuration.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  findClearAim,
  readCamera,
  signIn,
  toScreen,
  trackConsoleErrors,
  visiblePane,
  type ReadyTarget,
} from "./canvas-session";
import { localEnvGate } from "./local-env";
import { registerRunCleanup } from "./run-cleanup";

const gate = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "BROWSERLESS_TOKEN",
]);

const RUN_ID = `e2eplanes-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const BODY_PREFIX = `e2e-planes ${RUN_ID}:`;
// The fixtures host, never a Chickpea URL: a run-scoped project whose URL
// matches the seeded regex would hijack findReadyTarget's seeded-first pick
// for every concurrently running spec (the 2026-09-10 full-gate failure).
const LINKS = `${(
  JSON.parse(
    readFileSync(new URL("../test/fixtures/capture/host.json", import.meta.url), "utf8"),
  ) as { fixtures: Record<string, { url: string }> }
).fixtures["links-v1"]!.url}?run=${RUN_ID}`;
const PROJECT_TITLE = `${RUN_ID} planes`;

test.describe.configure({ mode: "serial" });

interface RunAttempt {
  id: string;
  attempt: number;
  state: string;
  errorCode: string | null;
  documentWidth: number | null;
  documentHeight: number | null;
}

interface RunDevice {
  variant: string;
  attempts: RunAttempt[];
}

/** This run's project, read from the hierarchy route. */
async function runProject(
  request: APIRequestContext,
): Promise<{ pages: { id: string; normalizedUrl: string; devices: RunDevice[] }[] } | null> {
  const response = await request.get("/api/projects");
  expect(response.status()).toBe(200);
  const { projects } = (await response.json()) as {
    projects: {
      title: string;
      pages: { id: string; normalizedUrl: string; devices: RunDevice[] }[];
    }[];
  };
  return projects.find((project) => project.title === PROJECT_TITLE) ?? null;
}

/** The ready capture with the given attempt number on one device. */
function attemptView(
  project: { pages: { devices: RunDevice[] }[] },
  variant: "desktop" | "mobile",
  attempt: number,
): RunAttempt | null {
  const device = project.pages[0]?.devices.find((candidate) => candidate.variant === variant);
  const found = device?.attempts.find(
    (candidate) => candidate.attempt === attempt && candidate.state === "ready",
  );
  return found ?? null;
}

/** A ReadyTarget-shaped handle for one of this run's own planes. */
function planeTarget(
  pageUrl: string,
  variant: "desktop" | "mobile",
  attempt: RunAttempt,
): ReadyTarget {
  return {
    pageUrl,
    variant,
    captureId: attempt.id,
    width: attempt.documentWidth!,
    height: attempt.documentHeight!,
  };
}

/** Select a plane and wait for its screenshot to decode. */
async function openPlane(page: Page, target: ReadyTarget): Promise<void> {
  const button = page.getByRole("button", {
    name: `${target.variant === "desktop" ? "Desktop" : "Mobile"} capture of ${target.pageUrl}`,
    exact: true,
  });
  // The rail collapses every project but the one holding the selection
  // (D070), so a plane in another project has to be revealed first.
  if (!(await button.isVisible())) {
    await page.locator("details.tree-project").filter({ has: button }).locator("> summary").first().click();
  }
  await button.click();
  await expect(page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` })).toBeVisible();
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(".capture-frame-image");
    return img !== null && img.complete && img.naturalWidth > 0;
  });
}

interface PinRecord {
  id: string;
  number: number;
  body: string;
  elementSnapshot?: { id: string; tag: string } | null;
}

/** This capture's live pins, read straight from the annotations route. */
async function listPins(page: Page, captureId: string): Promise<PinRecord[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`annotations list failed: ${response.status}`);
    const payload = (await response.json()) as { annotations: PinRecord[] };
    return payload.annotations;
  }, captureId);
}

/** The run's own pins on one capture. */
async function ownPins(page: Page, captureId: string): Promise<PinRecord[]> {
  return (await listPins(page, captureId)).filter((pin) => pin.body.startsWith(BODY_PREFIX));
}

/**
 * Write one pin on the current plane: draft at a clear aim, wait for the
 * context panel's quiescent marker, make the explicit context decision
 * (the first ranked candidate, or No element when asked), save, and wait
 * for the pin to persist.
 */
async function writePin(
  page: Page,
  target: ReadyTarget,
  body: string,
  withElement: boolean,
): Promise<void> {
  const before = await listPins(page, target.captureId);
  const pinButton = page.getByRole("button", { name: "Place pin" });
  if ((await pinButton.getAttribute("aria-pressed")) !== "true") await pinButton.click();
  const aim = await findClearAim(page, target.captureId, {
    width: target.width,
    height: target.height,
  });
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const local = toScreen(aim, camera);
  await page.mouse.click(pane.left + local.x, pane.top + local.y);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
  // The quiescent marker gates every radio interaction (the async
  // candidates render once detached a radio mid-click under load).
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
  );
  await page.getByLabel("Comment").fill(body);
  const candidates = page
    .getByTestId("draft-context")
    .locator(".panel-candidate[data-element-id]");
  const choseElement = withElement && (await candidates.count()) > 0;
  if (choseElement) {
    await candidates.first().getByRole("radio").check();
  } else {
    await page.getByRole("radio", { name: "No element" }).check();
  }
  await page.getByRole("button", { name: "Save pin" }).click();
  const beforeIds = new Set(before.map((pin) => pin.id));
  await expect
    .poll(
      async () =>
        (await listPins(page, target.captureId)).filter((pin) => !beforeIds.has(pin.id)).length,
    )
    .toBe(1);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(0);
}

// Setup test: create the run-scoped links project and let the loaded
// editor drive its Desktop and Mobile attempts to ready.
test("setup: the run-scoped links project is captured end to end", async ({ page }) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(420_000);
  await signIn(page);

  const csrf = (await page.context().cookies()).find((c) => c.name === "pinata_csrf")!.value;
  const created = await page.request.post("/api/projects", {
    headers: {
      "content-type": "application/json",
      "x-pinata-csrf": csrf,
      origin: new URL(page.url()).origin,
    },
    data: {
      title: PROJECT_TITLE,
      rootUrl: LINKS,
      urls: [],
      idempotencyKey: `${RUN_ID}-project`,
    },
  });
  expect(created.status()).toBe(201);

  await page.reload();
  await expect(page.getByRole("heading", { name: PROJECT_TITLE })).toBeVisible();
  await expect
    .poll(
      async () => {
        const project = await runProject(page.request);
        const devices = project?.pages[0]?.devices ?? [];
        const attempts = devices.flatMap((device) =>
          device.attempts.map((attempt) => ({ ...attempt, variant: device.variant })),
        );
        return attempts.length === 2 && attempts.every((attempt) => attempt.state === "ready")
          ? "ready"
          : `waiting ${attempts.map((attempt) => `${attempt.variant}:a${attempt.attempt}:${attempt.state}`).join(",")}`;
      },
      { timeout: 360_000, intervals: [2_000, 5_000] },
    )
    .toBe("ready");
});

test("pins and metadata choices stay isolated across Desktop, Mobile, old capture, and recapture (VAL-CANVAS-004)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(420_000);
  const consoleErrors = trackConsoleErrors(page);
  await signIn(page);

  const project = await runProject(page.request);
  test.skip(!project, "setup did not leave a ready run-scoped project");
  const pageRow = project!.pages[0]!;
  const desktopV1Attempt = attemptView(project!, "desktop", 1);
  const mobileAttempt = attemptView(project!, "mobile", 1);
  test.skip(!desktopV1Attempt || !mobileAttempt, "run project needs ready Desktop and Mobile");
  const desktopV1 = planeTarget(pageRow.normalizedUrl, "desktop", desktopV1Attempt!);
  const mobile = planeTarget(pageRow.normalizedUrl, "mobile", mobileAttempt!);

  // --- Desktop v1 (the old capture): a pin WITH an element choice.
  await openPlane(page, desktopV1);
  await writePin(page, desktopV1, `${BODY_PREFIX} desktop-v1`, true);
  const v1Pins = await ownPins(page, desktopV1.captureId);
  expect(v1Pins).toHaveLength(1);
  const v1ChoseElement = v1Pins[0]!.elementSnapshot != null;

  // --- Mobile: a distinguishable pin with the explicit No element choice.
  await openPlane(page, mobile);
  await writePin(page, mobile, `${BODY_PREFIX} mobile-v1`, false);
  expect(await ownPins(page, mobile.captureId)).toHaveLength(1);
  // Isolation, immediately: the desktop pin's comment is not on this plane.
  const mobileBodies = (await listPins(page, mobile.captureId)).map((pin) => pin.body);
  expect(mobileBodies.some((body) => body === `${BODY_PREFIX} desktop-v1`)).toBe(false);

  // --- Recapture: a new scoped Desktop attempt, driven to ready for real.
  const csrf = (await page.context().cookies()).find((c) => c.name === "pinata_csrf")!.value;
  const retried = await page.request.post(`/api/pages/${pageRow.id}/captures`, {
    headers: {
      "content-type": "application/json",
      "x-pinata-csrf": csrf,
      origin: new URL(page.url()).origin,
    },
    data: { variant: "desktop", idempotencyKey: `${RUN_ID}-recapture` },
  });
  expect([200, 201]).toContain(retried.status());
  // The attempt number THIS run created. The route answers with the attempt
  // record, not the bare number.
  const createdAttempt = (
    (await retried.json()) as { attempt: { attempt: number } }
  ).attempt.attempt;

  // A reload puts the pending attempt in the loaded client's dispatch view;
  // the driver claims and captures it with no test-side dispatch call.
  await page.reload();
  let recaptureId: string | null = null;
  await expect
    .poll(
      async () => {
        const current = await runProject(page.request);
        const device = current?.pages[0]?.devices.find(
          (candidate) => candidate.variant === "desktop",
        );
        // Report the full attempt ledger so a timeout names the stuck state.
        const ledger = (device?.attempts ?? []).map(
          (candidate) =>
            `a${candidate.attempt}:${candidate.state}${candidate.errorCode ? `(${candidate.errorCode})` : ""}`,
        );
        const recapture = device?.attempts.find(
          (candidate) => candidate.attempt === createdAttempt && candidate.state === "ready",
        );
        recaptureId = recapture?.id ?? null;
        return recaptureId !== null ? "ready" : `waiting ${ledger.join(",")}`;
      },
      { timeout: 300_000, intervals: [2_000, 5_000] },
    )
    .toBe("ready");

  // --- Desktop v2 (the recapture): the default plane now; the old pin is
  // NOT here, and a new pin with its own element choice lands only here.
  await page.reload();
  const desktopV2: ReadyTarget = {
    ...desktopV1,
    captureId: recaptureId!,
  };
  await openPlane(page, desktopV2);
  expect(await ownPins(page, recaptureId!)).toHaveLength(0);
  const v2Bodies = (await listPins(page, recaptureId!)).map((pin) => pin.body);
  expect(v2Bodies.some((body) => body === `${BODY_PREFIX} desktop-v1`)).toBe(false);
  await writePin(page, desktopV2, `${BODY_PREFIX} desktop-v2`, true);
  expect(await ownPins(page, recaptureId!)).toHaveLength(1);

  // --- Old capture via the Versions switcher: only its own pin, with its
  // own chosen snapshot, survives the plane switch.
  await page.getByRole("button", { name: /Version 1 — Ready/ }).click();
  await expect(
    page.getByRole("img", { name: `Screenshot of ${desktopV1.pageUrl}` }),
  ).toBeVisible();
  const v1AfterSwitch = await ownPins(page, desktopV1.captureId);
  expect(v1AfterSwitch).toHaveLength(1);
  expect(v1AfterSwitch[0]!.body).toBe(`${BODY_PREFIX} desktop-v1`);
  expect(v1AfterSwitch[0]!.elementSnapshot != null).toBe(v1ChoseElement);
  // And the recapture's pin did not bleed into the old plane.
  expect(
    (await listPins(page, desktopV1.captureId)).some(
      (pin) => pin.body === `${BODY_PREFIX} desktop-v2`,
    ),
  ).toBe(false);
  // UI parity: the old plane's list shows its pin and opening it shows its
  // comment (re-anchored to the panel after the version switch settles).
  await expect(page.getByTestId("capture-panel")).toContainText(/No pins yet\.|Pin \d+ — at \(/);
  await page.getByRole("button", { name: `Pin ${v1AfterSwitch[0]!.number} — at (` }).click();
  await expect(page.getByTestId("panel-pin")).toContainText(`${BODY_PREFIX} desktop-v1`);

  // --- After a full reload, every plane still shows only its own marks.
  await page.reload();
  await openPlane(page, desktopV2);
  expect((await ownPins(page, recaptureId!)).map((pin) => pin.body)).toEqual([
    `${BODY_PREFIX} desktop-v2`,
  ]);
  await page.getByRole("button", { name: /Version 1 — Ready/ }).click();
  expect((await ownPins(page, desktopV1.captureId)).map((pin) => pin.body)).toEqual([
    `${BODY_PREFIX} desktop-v1`,
  ]);
  await openPlane(page, mobile);
  expect((await ownPins(page, mobile.captureId)).map((pin) => pin.body)).toEqual([
    `${BODY_PREFIX} mobile-v1`,
  ]);

  expect(consoleErrors).toEqual([]);
});

// Run-scoped cleanup is REGISTERED here and executed by the Playwright
// global teardown, after every worker's last page has closed — a sibling
// spec's page can still be auto-observing this run's rows while this
// suite's afterAll runs (e2e/run-cleanup.ts documents the 404 race).
test.afterAll(() => {
  if (!gate.ready) return;
  registerRunCleanup({
    runId: RUN_ID,
    bodyPrefixes: [BODY_PREFIX],
    suite: "pin-planes",
  });
});
