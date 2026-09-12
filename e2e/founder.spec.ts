// End-to-end contract for founder links and two-way threads (REQUIREMENTS 6
// and 7, VAL-THREAD-001, VAL-THREAD-003, VAL-THREAD-005): the editor issues
// a link whose token rides only in the fragment; a fresh browser context
// opens it as the founder, sees a read/reply-only view with no editing
// control, reads a pin's comment, and appends a reply labelled `founder`;
// the editor sees that reply under the pin and follows up as `Lucas`; the
// founder sees the follow-up; and rotating the link ends the old founder
// session while the new link keeps working. The founder page sends no
// referrer and permits no indexing. With D075 the same run also covers the
// feedback loop: the share control with its state in the project header,
// the founder's pin list above the canvas, the founder resolving the pin,
// and the editor reopening it, each recorded as a status line in the thread.
//
// Runs against the seeded local store like the pin specs and skips without
// local configuration. The spec appends replies to one fixture pin on the
// seeded Chickpea DESKTOP capture (reused by body prefix across runs, so no
// pin is ever created per run) and leaves the seeded project with a rotated
// then revoked founder link; thread entries are append-only by design, so
// each run adds exactly two immutable rows and nothing is cleaned up.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  findClearAim,
  findReadyTarget,
  openPlane,
  signIn,
  trackConsoleErrors,
  type ReadyTarget,
} from "./canvas-session";
import { localEnvGate } from "./local-env";
import { stubDispatchQuota } from "./stub-dispatch";

const gate = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
]);

test.describe.configure({ mode: "serial" });

const FIXTURE_BODY_PREFIX = "e2e: founder thread fixture";
const BOX_FIXTURE_BODY_PREFIX = "e2e: founder box fixture";

interface PinRecord {
  id: string;
  kind?: "pin" | "rectangle";
  number: number;
  tip: { x: number; y: number };
  /** A rectangle's box (D079); absent on pins. */
  rect?: { x: number; y: number; width: number; height: number };
  body: string;
  status: "open" | "replied" | "resolved";
  unreadReplies: number;
}

interface ThreadEntry {
  id: string;
  actorRole: string;
  authorLabel: string;
  body: string;
}

/** The editor's CSRF proof, read from the browser-readable cookie. */
async function csrfProof(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "pinata_csrf")?.value ?? "";
}

async function listPins(page: Page, captureId: string): Promise<PinRecord[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`annotations list failed: ${response.status}`);
    return ((await response.json()) as { annotations: PinRecord[] }).annotations;
  }, captureId);
}

async function listThread(page: Page, captureId: string, annotationId: string): Promise<ThreadEntry[]> {
  return page.evaluate(
    async ({ id, pin }) => {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(id)}/annotations/${encodeURIComponent(pin)}/thread`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`thread list failed: ${response.status}`);
      return ((await response.json()) as { entries: ThreadEntry[] }).entries;
    },
    { id: captureId, pin: annotationId },
  );
}

/** Find or create the one fixture pin this spec replies to. */
async function fixturePin(page: Page, target: ReadyTarget): Promise<PinRecord> {
  const existing = (await listPins(page, target.captureId)).find((pin) =>
    pin.body.startsWith(FIXTURE_BODY_PREFIX),
  );
  if (existing) return existing;
  const aim = await findClearAim(page, target.captureId, target, { from: 0.8, to: 0.95 });
  const proof = await csrfProof(page);
  return page.evaluate(
    async ({ id, tip, body, csrf }) => {
      const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-pinata-csrf": csrf },
        body: JSON.stringify({
          tip,
          body,
          elementId: null,
          idempotencyKey: `founder-fixture-${Math.random().toString(36).slice(2, 14)}`,
        }),
      });
      if (!response.ok) throw new Error(`fixture pin create failed: ${response.status}`);
      return ((await response.json()) as { annotation: PinRecord }).annotation;
    },
    {
      id: target.captureId,
      tip: aim,
      body: `${FIXTURE_BODY_PREFIX} — reply target on ${target.pageUrl}`,
      csrf: proof,
    },
  );
}

/**
 * Find or create the one fixture box (D079) the founder must see read-only.
 * Never written to again: it exists so the founder's list and canvas can be
 * checked against a rectangle without creating one per run.
 */
async function fixtureBox(page: Page, target: ReadyTarget): Promise<PinRecord> {
  const existing = (await listPins(page, target.captureId)).find((mark) =>
    mark.body.startsWith(BOX_FIXTURE_BODY_PREFIX),
  );
  if (existing) return existing;
  const size = { width: 160, height: 90 };
  const aim = await findClearAim(page, target.captureId, target, { from: 0.6, to: 0.75 });
  const rect = {
    x: Math.min(aim.x, target.width - size.width),
    y: Math.min(aim.y, target.height - size.height),
    ...size,
  };
  const proof = await csrfProof(page);
  return page.evaluate(
    async ({ id, box, body, csrf }) => {
      const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-pinata-csrf": csrf },
        body: JSON.stringify({
          rect: box,
          body,
          elementId: null,
          idempotencyKey: `founder-box-fixture-${Math.random().toString(36).slice(2, 14)}`,
        }),
      });
      if (!response.ok) throw new Error(`fixture box create failed: ${response.status}`);
      return ((await response.json()) as { annotation: PinRecord }).annotation;
    },
    {
      id: target.captureId,
      box: rect,
      body: `${BOX_FIXTURE_BODY_PREFIX} — read-only box on ${target.pageUrl}`,
      csrf: proof,
    },
  );
}

/**
 * The fixture pin is reused across runs and each run resolves then reopens
 * it (D075). A run that stopped in between leaves it resolved, so start
 * every run from an unresolved pin through the editor's reopen route.
 */
async function ensureUnresolved(page: Page, captureId: string, pin: PinRecord): Promise<void> {
  if (pin.status !== "resolved") return;
  const proof = await csrfProof(page);
  await page.evaluate(
    async ({ id, annotationId, csrf }) => {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(id)}/annotations/${encodeURIComponent(annotationId)}/reopen`,
        { method: "POST", headers: { "x-pinata-csrf": csrf } },
      );
      if (!response.ok) throw new Error(`fixture reopen failed: ${response.status}`);
    },
    { id: captureId, annotationId: pin.id, csrf: proof },
  );
}

/** Issue (or rotate) the founder link for the project through the editor route. */
async function issueLink(page: Page, publicId: string): Promise<{ path: string; token: string; version: number }> {
  const proof = await csrfProof(page);
  return page.evaluate(
    async ({ id, csrf }) => {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/share`, {
        method: "POST",
        headers: { "x-pinata-csrf": csrf },
      });
      if (!response.ok) throw new Error(`share issue failed: ${response.status}`);
      const payload = (await response.json()) as {
        path: string;
        token: string;
        share: { version: number };
      };
      return { path: payload.path, token: payload.token, version: payload.share.version };
    },
    { id: publicId, csrf: proof },
  );
}

async function revokeLink(page: Page, publicId: string): Promise<void> {
  const proof = await csrfProof(page);
  await page.evaluate(
    async ({ id, csrf }) => {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/share`, {
        method: "DELETE",
        headers: { "x-pinata-csrf": csrf },
      });
      if (!response.ok) throw new Error(`share revoke failed: ${response.status}`);
    },
    { id: publicId, csrf: proof },
  );
}

/** The seeded project's public id, found through the editor hierarchy. */
async function publicIdFor(page: Page, target: ReadyTarget): Promise<string> {
  return page.evaluate(async (title) => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const payload = (await response.json()) as {
      projects: { publicId: string; title: string; createdAt: number }[];
    };
    const matches = payload.projects.filter((project) => project.title === title);
    // The oldest matching project is the local seed (see canvas-session.ts).
    const oldest = matches.reduce<(typeof matches)[number] | null>(
      (best, candidate) => (best === null || candidate.createdAt < best.createdAt ? candidate : best),
      null,
    );
    if (!oldest) throw new Error("seeded project not found");
    return oldest.publicId;
  }, target.projectTitle);
}

/** Open a founder link in a brand-new context (no editor cookies at all). */
async function openAsFounder(
  context: BrowserContext,
  link: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

test("founder link opens a read/reply-only view; founder and editor interleave; rotation ends the old link", async ({
  page,
  browser,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const editorErrors = trackConsoleErrors(page);
  await stubDispatchQuota(page);
  await signIn(page);
  const target = await findReadyTarget(page, "desktop", "https://chickpea.co/");
  test.skip(!target, "no ready seeded desktop capture in the local store");
  await openPlane(page, target!);
  const publicId = await publicIdFor(page, target!);
  const pin = await fixturePin(page, target!);
  await ensureUnresolved(page, target!.captureId, pin);
  const box = await fixtureBox(page, target!);
  const runTag = `${Date.now().toString(36)}`;

  // The editor issues the link: the token is in the fragment, nowhere else.
  const first = await issueLink(page, publicId);
  expect(first.path).toBe(`/f/${publicId}`);
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const firstLink = `http://127.0.0.1:3100${first.path}#${first.token}`;

  // The share control sits in the selected project's header (D075), not in
  // the rail, and shows the link state without being opened. The status was
  // read when the header mounted, so reload the workspace to see the link
  // issued above.
  await page.reload();
  await openPlane(page, target!);
  const projectHeader = page.getByTestId("project-header");
  await expect(projectHeader.getByTestId("project-title")).toHaveText(target!.projectTitle!);
  await expect(projectHeader.getByTestId("founder-share-state")).toHaveText(
    `Founder link active · v${first.version}`,
  );
  await expect(
    page.getByRole("navigation", { name: "Projects and pages" }).getByRole("button", {
      name: "Share with founder",
    }),
  ).toHaveCount(0);
  const shareToggle = projectHeader.getByRole("button", { name: "Share with founder" });
  await shareToggle.click();
  await expect(page.getByText(`Founder link active (version ${first.version}).`)).toBeVisible();
  await shareToggle.click();

  // A fresh browser context: no editor cookie, only the link.
  const founderContext = await browser.newContext();
  const founderErrors: string[] = [];
  const founder = await openAsFounder(founderContext, firstLink);
  founder.on("pageerror", (error) => founderErrors.push(String(error)));

  // The founder page sends no referrer and permits no indexing.
  const pageResponse = await founder.request.get(first.path);
  expect(pageResponse.headers()["referrer-policy"]).toBe("no-referrer");
  expect(pageResponse.headers()["x-robots-tag"]).toContain("noindex");
  expect(pageResponse.headers()["x-frame-options"]).toBe("DENY");

  await expect(founder.getByTestId("founder-view")).toBeVisible();
  // The fragment is scrubbed after the one-time exchange.
  expect(new URL(founder.url()).hash).toBe("");
  expect(founder.url()).not.toContain(first.token);
  const founderCookies = await founderContext.cookies();
  const founderSession = founderCookies.find((c) => c.name === "pinata_founder_session");
  expect(founderSession?.httpOnly).toBe(true);
  expect(founderSession?.sameSite).toBe("Strict");
  expect(founderCookies.find((c) => c.name === "pinata_editor_session")).toBeUndefined();

  // Read/reply-only: no editing control exists in the DOM.
  await expect(founder.getByText("Viewing as founder")).toBeVisible();
  await founder
    .getByRole("button", { name: `Desktop capture of ${target!.pageUrl}`, exact: true })
    .click();
  await expect(founder.getByRole("img", { name: `Screenshot of ${target!.pageUrl}` })).toBeVisible();
  for (const name of [
    "Edit comment",
    "Delete pin",
    "Delete box",
    "Save pin",
    "Save box",
    "Draw a box",
    "Share with founder",
  ]) {
    await expect(founder.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(founder.getByRole("radio")).toHaveCount(0);
  await expect(founder.getByTestId("pin-composer")).toHaveCount(0);
  await expect(founder.locator(".capture-canvas[data-read-only='true']")).toHaveCount(1);
  // The private asset loads for the founder through the authorized route.
  await founder.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(".capture-frame-image");
    return img !== null && img.complete && img.naturalWidth > 0;
  });

  // The pin list above the canvas (D075) names every pin with its comment
  // excerpt and status; the fixture pin's entry opens it.
  const founderPinList = founder.getByTestId("founder-pin-list");
  await expect(founderPinList).toBeVisible();
  const fixtureEntry = founderPinList.getByRole("button", {
    name: new RegExp(`^Pin ${pin.number} —`),
  });
  await expect(fixtureEntry).toContainText(FIXTURE_BODY_PREFIX);
  await expect(fixtureEntry).toContainText(/Open|Replied/);
  // The list sits above the canvas.
  const listBox = (await founderPinList.boundingBox())!;
  const canvasBox = (await founder.locator(".capture-canvas").boundingBox())!;
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(canvasBox.y + 1);

  // The fixture box (D079) is listed as a box, drawn on the read-only plane
  // with no handles and no drag, and readable with its bounds.
  const boxEntry = founderPinList.getByRole("button", {
    name: new RegExp(`^Box ${box.number} —`),
  });
  await expect(boxEntry).toContainText(BOX_FIXTURE_BODY_PREFIX);
  const boxNode = founder.locator(".react-flow__node-rectangle", {
    has: founder.locator(`[data-testid="rectangle-badge"][data-mark-number="${box.number}"]`),
  });
  await expect(boxNode).toHaveCount(1);
  await expect(founder.locator('[data-testid="rectangle-handle"]')).toHaveCount(0);
  expect(await boxNode.getAttribute("class")).not.toMatch(/\bdraggable\b/);
  await boxEntry.click();
  await expect(founder.getByTestId("founder-panel").getByTestId("panel-position")).toContainText(
    `Box ${box.number} at natural pixels (`,
  );
  await expect(founder.getByTestId("founder-panel")).toContainText(BOX_FIXTURE_BODY_PREFIX);
  // A Shift-drag on the founder's plane draws nothing.
  const founderCanvas = (await founder.locator(".capture-canvas").boundingBox())!;
  await founder.keyboard.down("Shift");
  await founder.mouse.move(founderCanvas.x + founderCanvas.width / 2, founderCanvas.y + founderCanvas.height / 2);
  await founder.mouse.down();
  await founder.mouse.move(founderCanvas.x + founderCanvas.width / 2 + 80, founderCanvas.y + founderCanvas.height / 2 + 60, { steps: 6 });
  await founder.mouse.up();
  await founder.keyboard.up("Shift");
  await expect(founder.locator(".react-flow__node-draftRectangle")).toHaveCount(0);
  await expect(founder.getByTestId("pin-composer")).toHaveCount(0);

  // The founder opens the fixture pin and replies.
  await fixtureEntry.click();
  await expect(fixtureEntry).toHaveAttribute("aria-current", "true");
  const founderPanel = founder.getByTestId("founder-panel");
  await expect(founderPanel).toContainText(FIXTURE_BODY_PREFIX);
  const founderReply = `founder reply ${runTag}`;
  await founderPanel.getByLabel("Reply as founder").fill(founderReply);
  await founderPanel.getByRole("button", { name: "Send reply" }).click();
  await expect(founderPanel.locator(".thread-entry[data-author='founder']").last()).toContainText(
    founderReply,
  );

  // The founder resolves the pin (D075): the status changes, the thread
  // records a server-written status line, and the list entry follows.
  await founderPanel.getByRole("button", { name: "Resolve pin" }).click();
  await expect(founderPanel.getByTestId("panel-status")).toHaveText("Status: Resolved");
  await expect(founderPanel.locator(".thread-status").last()).toContainText("Resolved by founder");
  await expect(founderPanel.getByRole("button", { name: "Reopen pin" })).toBeVisible();
  await expect(fixtureEntry).toContainText("Resolved");

  // The editor sees the founder's reply under the pin and follows up.
  await page.getByRole("button", { name: new RegExp(`^Pin ${pin.number} —`) }).click();
  const editorPanel = page.getByTestId("capture-panel");
  await expect(editorPanel.getByTestId("thread")).toBeVisible();
  await expect(editorPanel.locator(".thread-entry[data-author='founder']").last()).toContainText(
    founderReply,
  );
  // The editor sees the founder's resolve as status and as a thread line.
  await expect(editorPanel.getByTestId("panel-status")).toHaveText("Status: Resolved");
  await expect(editorPanel.locator(".thread-status").last()).toContainText("Resolved by founder");
  const editorFollowUp = `editor follow-up ${runTag}`;
  await editorPanel.getByLabel("Follow up as Lucas").fill(editorFollowUp);
  await editorPanel.getByRole("button", { name: "Send follow-up" }).click();
  await expect(editorPanel.locator(".thread-entry[data-author='Lucas']").last()).toContainText(
    editorFollowUp,
  );
  // The editor reopens it: the founder has replied, so the pin is "replied",
  // and the change is one more immutable status line.
  await editorPanel.getByRole("button", { name: "Reopen pin" }).click();
  await expect(editorPanel.getByTestId("panel-status")).toHaveText("Status: Replied");
  await expect(editorPanel.locator(".thread-status").last()).toContainText("Reopened by editor");
  await expect(editorPanel.getByRole("button", { name: "Resolve pin" })).toBeVisible();

  // The durable thread carries both, in order, with server labels.
  const entries = await listThread(page, target!.captureId, pin.id);
  const ours = entries.filter((entry) => entry.body.endsWith(runTag));
  expect(ours.map((entry) => [entry.actorRole, entry.authorLabel])).toEqual([
    ["founder", "founder"],
    ["editor", "Lucas"],
  ]);

  // The founder sees the follow-up after a reload (same cookie, no fragment).
  await founder.reload();
  await expect(founder.getByTestId("founder-view")).toBeVisible();
  await founder
    .getByRole("button", { name: `Desktop capture of ${target!.pageUrl}`, exact: true })
    .click();
  await founder.getByRole("button", { name: new RegExp(`^Pin ${pin.number} —`) }).click();
  await expect(
    founder.getByTestId("founder-panel").locator(".thread-entry[data-author='Lucas']").last(),
  ).toContainText(editorFollowUp);
  // The editor's reopen is visible to the founder as the pin's status.
  await expect(founder.getByTestId("founder-panel").getByTestId("panel-status")).toHaveText(
    "Status: Replied",
  );

  // Rotation: the old session and the old link both die; the new link works.
  const second = await issueLink(page, publicId);
  expect(second.version).toBe(first.version + 1);
  await founder.reload();
  await expect(founder.getByTestId("founder-denied")).toBeVisible();
  await expect(founder.getByTestId("founder-view")).toHaveCount(0);
  const stale = await openAsFounder(founderContext, firstLink);
  await expect(stale.getByTestId("founder-denied")).toBeVisible();
  const secondLink = `http://127.0.0.1:3100${second.path}#${second.token}`;
  const freshContext = await browser.newContext();
  const fresh = await openAsFounder(freshContext, secondLink);
  await expect(fresh.getByTestId("founder-view")).toBeVisible();

  // Revocation ends access without deleting history.
  await revokeLink(page, publicId);
  await fresh.reload();
  await expect(fresh.getByTestId("founder-denied")).toBeVisible();
  const afterRevoke = await listThread(page, target!.captureId, pin.id);
  expect(afterRevoke.length).toBe(entries.length);

  await founderContext.close();
  await freshContext.close();
  expect(editorErrors).toEqual([]);
  expect(founderErrors).toEqual([]);
});
