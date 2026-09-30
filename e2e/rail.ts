// The project drawer (D106) starts closed and closes itself after a choice,
// so a spec reaches the rail the way a reader does: open it first.
import type { Locator, Page } from "@playwright/test";

/** Open the project drawer if it is closed, and return it. */
export async function openRail(page: Page): Promise<Locator> {
  const show = page.getByRole("button", { name: "Show projects" });
  if ((await show.count()) > 0) await show.click();
  return page.getByRole("navigation", { name: "Projects and pages" });
}
