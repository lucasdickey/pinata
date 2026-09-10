// The deferred HTTP-surface half of VAL-CAPTURE-006, now that the authorized
// manifest read route exists: a real Browserless capture of the controlled
// manifest-v1 fixture is persisted, then an authorized GET of
// /api/captures/[captureId]/manifest must return persisted JSON containing
// ZERO SENTINEL-/forbidden-source values while every visible MANIFEST-*
// landmark survives. The same project captures tall-motion-v1, whose
// animated subtree must rank in the nearby-candidate surface with the
// SAME layout rect the stabilized screenshot shows (VAL-PIN-010), and the
// manifest-v1 closed <details> menu proves closed-node exclusion at the
// ranking surface while its visible summary stays selectable (VAL-PIN-006).
//
// Cost: one project, two pages, four real captures. Everything is
// run-scoped and deleted — and verified absent — by the Playwright global
// teardown (registered in afterAll, executed after every worker's last
// page has closed — see e2e/run-cleanup.ts), never in a trailing test.
// Gates on the full local configuration and skips with a name-only reason
// in CI.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { localEnvGate, requireLocalEnvValue } from "./local-env";
import { registerRunCleanup } from "./run-cleanup";

const gate = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "BROWSERLESS_TOKEN",
]);

const RUN_ID = `e2escan-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

const FIXTURE_HOST = JSON.parse(
  readFileSync(new URL("../test/fixtures/capture/host.json", import.meta.url), "utf8"),
) as { fixtures: Record<string, { url: string }> };
const MANIFEST_URL = `${FIXTURE_HOST.fixtures["manifest-v1"]!.url}?run=${RUN_ID}`;
const MOTION_URL = `${FIXTURE_HOST.fixtures["tall-motion-v1"]!.url}?run=${RUN_ID}`;
const PROJECT_TITLE = `${RUN_ID} manifest scan`;

test.describe.configure({ mode: "serial" });

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();
}

interface RunPage {
  id: string;
  normalizedUrl: string;
  devices: {
    variant: string;
    attempts: { id: string; state: string; documentWidth: number | null }[];
  }[];
}

async function runProject(request: APIRequestContext): Promise<{ pages: RunPage[] } | null> {
  const response = await request.get("/api/projects");
  expect(response.status()).toBe(200);
  const { projects } = (await response.json()) as {
    projects: { title: string; pages: RunPage[] }[];
  };
  return projects.find((project) => project.title === PROJECT_TITLE) ?? null;
}

/** This run's ready desktop capture id for one fixture page. */
async function readyDesktopCaptureId(
  request: APIRequestContext,
  pageUrl: string,
): Promise<string> {
  const project = await runProject(request);
  const pageRow = project?.pages.find((candidate) => candidate.normalizedUrl === pageUrl);
  const device = pageRow?.devices.find((candidate) => candidate.variant === "desktop");
  const ready = device?.attempts.find((attempt) => attempt.state === "ready");
  if (!ready) throw new Error(`no ready desktop capture for ${pageUrl}`);
  return ready.id;
}

// Setup test: create the project outside the browser, then let the loaded
// editor drive all four attempts to ready. Every later test reads.
test("setup: the fixture project is captured end to end", async ({ page }) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(360_000);
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
      rootUrl: MANIFEST_URL,
      urls: [MOTION_URL],
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
        return project
          ? project.pages
              .flatMap((p) => p.devices)
              .flatMap((d) => d.attempts)
              .filter((a) => a.state === "ready").length
          : 0;
      },
      { timeout: 300_000, intervals: [2_000, 5_000] },
    )
    .toBe(4);
});

test("an authorized manifest read contains zero forbidden-source values and every visible landmark (VAL-CAPTURE-006)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);
  await signIn(page);
  const captureId = await readyDesktopCaptureId(page.request, MANIFEST_URL);

  // The deferred curl(manifest-forbidden-value-sentinel-scan) evidence: an
  // authorized fetch of the persisted manifest JSON over the read route.
  const response = await page.request.get(
    `/api/captures/${encodeURIComponent(captureId)}/manifest`,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.text();

  // Zero SENTINEL- values anywhere in the persisted surface: hidden,
  // clipped, sr-only, off-canvas, aria-hidden, closed-menu, form values,
  // URL-bearing attributes, templates, noscript, shadow roots, scripts,
  // styles, cookies, and storage all stay out (VAL-CAPTURE-006).
  expect(body).not.toContain("SENTINEL-");
  // The visible semantic landmarks survived, top to bottom.
  for (const landmark of [
    "MANIFEST-TOP-LANDMARK",
    "MANIFEST-VISIBLE-SIBLING-ONE",
    "MANIFEST-MENU-SUMMARY",
    "MANIFEST-FORM-BUTTON",
    "MANIFEST-HOSTILE",
    "MANIFEST-MIDDLE-LANDMARK",
    "MANIFEST-BOTTOM-LANDMARK",
  ]) {
    expect(body, landmark).toContain(landmark);
  }
  // The hostile-but-visible text persists as inert DATA inside the JSON
  // surface: markup characters stay string content, never markup.
  const parsed = JSON.parse(body) as {
    elements: { text: string; kind: string; tag: string }[];
  };
  const hostile = parsed.elements.find((element) => element.text.includes("MANIFEST-HOSTILE"));
  expect(hostile, "hostile element persisted").toBeDefined();
  expect(hostile!.tag).toBe("p");

  // The same read without authority is forbidden (the curl 401 half): a
  // fresh request context carries no session cookie.
  const anonymous = await playwrightRequest.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const denied = await anonymous.get(
      `/api/captures/${encodeURIComponent(captureId)}/manifest`,
    );
    expect(denied.status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
});

test("the closed details menu is absent from candidates while its visible summary stays selectable (VAL-PIN-006)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);
  await signIn(page);
  const captureId = await readyDesktopCaptureId(page.request, MANIFEST_URL);

  interface Candidate {
    id: string;
    tag: string;
    text: string;
    rect: { x: number; y: number; width: number; height: number };
  }
  const candidatesAt = async (point: { x: number; y: number }) => {
    const response = await page.request.get(
      `/api/captures/${encodeURIComponent(captureId)}/context?x=${point.x}&y=${point.y}`,
    );
    expect(response.status()).toBe(200);
    return ((await response.json()) as { candidates: Candidate[] }).candidates;
  };

  // The closed menu's link lived around (24+padding, menu row); query the
  // summary's own neighborhood. The summary is visible; the closed <nav>
  // link is not — no candidate may carry its text or href-derived hints.
  const manifest = await (
    await page.request.get(`/api/captures/${encodeURIComponent(captureId)}/manifest`)
  ).json();
  const summary = (manifest as { elements: Candidate[] }).elements.find((element) =>
    element.text.includes("MANIFEST-MENU-SUMMARY"),
  );
  expect(summary, "menu summary persisted").toBeDefined();
  const center = {
    x: summary!.rect.x + summary!.rect.width / 2,
    y: summary!.rect.y + summary!.rect.height / 2,
  };
  const candidates = await candidatesAt(center);
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates.some((candidate) => candidate.id === summary!.id)).toBe(true);
  for (const candidate of candidates) {
    expect(JSON.stringify(candidate)).not.toContain("SENTINEL-");
  }
});

test("the stabilized animated subtree ranks with its settled same-layout rect (VAL-PIN-010)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);
  await signIn(page);
  const captureId = await readyDesktopCaptureId(page.request, MOTION_URL);

  interface ManifestElement {
    id: string;
    kind: string;
    tag: string;
    text: string;
    hints: { id: string };
    rect: { x: number; y: number; width: number; height: number };
  }
  const manifest = (await (
    await page.request.get(`/api/captures/${encodeURIComponent(captureId)}/manifest`)
  ).json()) as { elements: ManifestElement[] };

  // The animated region's COLLECTED elements: the animated image (kind
  // image) and the css-animation section's heading. The spin-box itself is
  // a wrapper-only div, excluded from every manifest by design — assert
  // that absence too, here where the animated subtree lives.
  expect(manifest.elements.some((element) => element.hints.id === "spin-box")).toBe(false);
  const gif = manifest.elements.find((element) => element.hints.id === "animated-gif");
  expect(gif, "animated image persisted").toBeDefined();
  expect(gif!.kind).toBe("image");
  expect(Math.abs(gif!.rect.width - 120)).toBeLessThanOrEqual(1);
  expect(Math.abs(gif!.rect.height - 120)).toBeLessThanOrEqual(1);
  const heading = manifest.elements.find((element) =>
    element.text.includes("motion-case css-animation"),
  );
  expect(heading, "animated subtree heading persisted").toBeDefined();

  // Querying each element's settled center ranks it with a rect EQUAL to
  // the persisted one: the ranking surface and the stabilized screenshot
  // describe the same layout, so the preview highlight overlays the frozen
  // pixels exactly rather than a mid-animation position.
  const candidatesAt = async (element: ManifestElement) => {
    const center = {
      x: element.rect.x + element.rect.width / 2,
      y: element.rect.y + element.rect.height / 2,
    };
    const response = await page.request.get(
      `/api/captures/${encodeURIComponent(captureId)}/context?x=${center.x}&y=${center.y}`,
    );
    expect(response.status()).toBe(200);
    const { candidates } = (await response.json()) as { candidates: ManifestElement[] };
    return candidates.find((candidate) => candidate.id === element.id);
  };
  const rankedGif = await candidatesAt(gif!);
  expect(rankedGif, "animated image ranked at its own center").toBeDefined();
  expect(rankedGif!.rect).toEqual(gif!.rect);
  const rankedHeading = await candidatesAt(heading!);
  expect(rankedHeading, "animated subtree heading ranked").toBeDefined();
  expect(rankedHeading!.rect).toEqual(heading!.rect);
});

// Run-scoped cleanup is REGISTERED here and executed by the Playwright
// global teardown, after every worker's last page has closed — a sibling
// spec's page can still be auto-observing this run's rows while this
// suite's afterAll runs (e2e/run-cleanup.ts documents the 404 race). This
// suite writes no annotations, so the body prefix list is empty.
test.afterAll(() => {
  if (!gate.ready) return;
  registerRunCleanup({ runId: RUN_ID, bodyPrefixes: [], suite: "manifest-scan" });
});
