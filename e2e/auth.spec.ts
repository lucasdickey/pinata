// End-to-end proof of the editor auth boundary against the production build
// (VAL-AUTH-001): clean-browser prompt shape, wrong/valid login transitions,
// cookie attributes, logout, post-logout replay denial, and a public-asset
// secret scan. The editor password is read from the environment and never
// logged.
//
// The prompt-shape and public-asset checks need no configuration and run
// everywhere, including CI. The rest gate on what the server needs to answer
// them meaningfully, and skip with a name-only reason otherwise: the protected
// read fails closed with a 503 (not the 401 under test) when SESSION_SECRET is
// absent, and login additionally needs the editor password and the durable
// throttle store the route requires before it will verify anything.

import { expect, test } from "@playwright/test";
import { localEnvGate, requireLocalEnvValue } from "./local-env";

const sessionEnv = localEnvGate(["SESSION_SECRET"]);
const loginEnv = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
]);

test("a clean browser sees one masked password prompt and no editor data", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "pinata" })).toBeVisible();

  const password = page.getByLabel("Password");
  await expect(password).toBeVisible();
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  // No editor surface, no account machinery beyond the one prompt.
  await expect(page.getByText("Signed in as Lucas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByLabel(/email|username/i)).toHaveCount(0);

  // No cookies are set for an anonymous visitor.
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.startsWith("pinata_"))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("wrong password is denied; the configured password establishes a session; logout ends it", async ({
  page,
}) => {
  test.skip(!loginEnv.ready, loginEnv.reason);
  await page.goto("/");

  // Wrong password: generic error, no session cookie.
  await page.getByLabel("Password").fill("definitely-the-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("p[role='alert']")).toHaveText("The password did not match.");
  expect(await page.context().cookies()).toEqual([]);
  await expect(page.getByLabel("Password")).toHaveValue("");

  // Valid password: editor shell appears, session cookies carry the policy
  // attributes.
  await page.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();

  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "pinata_editor_session");
  const csrf = cookies.find((c) => c.name === "pinata_csrf");
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Strict");
  expect(session?.path).toBe("/");
  expect(csrf).toBeDefined();
  expect(csrf?.httpOnly).toBe(false);

  // Logout returns to the password prompt and clears the cookies.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Password")).toBeVisible();
  expect(await page.context().cookies()).toEqual([]);

  // The pre-logout session cookie cannot be replayed.
  const replay = await page.request.get("/api/editor/session", {
    headers: { cookie: `pinata_editor_session=${session!.value}` },
  });
  expect(replay.status()).toBe(401);
});

test("anonymous callers are denied the protected editor read", async ({ page }) => {
  test.skip(!sessionEnv.ready, sessionEnv.reason);
  const response = await page.request.get("/api/editor/session");
  expect(response.status()).toBe(401);
  const body = await response.text();
  expect(body.length).toBeLessThan(200);
});

test("public HTML and client bundles contain no secret names", async ({ page, request }) => {
  const response = await page.goto("/");
  const html = await response!.text();
  for (const name of [
    "EDITOR_PASSWORD",
    "SESSION_SECRET",
    "TURSO_AUTH_TOKEN",
    "TURSO_DATABASE_URL",
    "BLOB_READ_WRITE_TOKEN",
    "BROWSERLESS_TOKEN",
  ]) {
    expect(html).not.toContain(name);
  }

  const scriptUrls = await page.$$eval("script[src]", (els) =>
    els.map((el) => (el as HTMLScriptElement).src),
  );
  expect(scriptUrls.length).toBeGreaterThan(0);
  for (const url of scriptUrls) {
    const scriptResponse = await request.get(url);
    const body = await scriptResponse.text();
    expect(body).not.toContain("EDITOR_PASSWORD");
    expect(body).not.toContain("SESSION_SECRET");
    expect(body).not.toContain("TURSO_AUTH_TOKEN");
    expect(body).not.toContain("BLOB_READ_WRITE_TOKEN");
  }
});

test("the login response never echoes the submitted password", async ({ request }) => {
  test.skip(!loginEnv.ready, loginEnv.reason);
  const editorPassword = requireLocalEnvValue("EDITOR_PASSWORD");
  for (const password of [editorPassword, "unique-wrong-password-sentinel-zq8x"]) {
    const response = await request.post("/api/auth/login", {
      headers: { "content-type": "application/json" },
      data: { password },
    });
    const text = await response.text();
    expect(text.includes(password)).toBe(false);
    for (const cookie of response.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie")) {
      expect(cookie.value.includes(password)).toBe(false);
    }
  }
});
