// Shared e2e hermeticity helper. The editor's fallback dispatch driver
// drives every pending attempt it can see through the scoped dispatch route,
// so any spec that signs in and opens the editor home would otherwise fire
// browser-issued provider captures for whatever happens to be pending in the
// shared local database. Specs that are not about capture execution stub the
// route with the durable quota-exceeded outcome: attempts stay pending from
// the browser's point of view and the driver's defer-and-redrive path is
// exercised. Note what this does not cover since D076: the server continues
// capture work on its own after a project is created or retried, and that
// continuation never passes through the browser, so a spec that creates a
// project against a configured local environment still produces real
// captures for that project.

import type { Page } from "@playwright/test";

/** Answer every capture-dispatch POST with the published 429 quota outcome. */
export async function stubDispatchQuota(page: Page): Promise<void> {
  await page.route("**/api/captures/*/dispatch", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Too many captures are active or scheduled right now.",
        code: "quota-exceeded",
        remediation: "Wait for a running capture to finish, then retry.",
      }),
    });
  });
}
