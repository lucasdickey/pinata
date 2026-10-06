// The project drawer (D106) starts closed and closes itself after a choice,
// so a spec reaches the rail the way a reader does: open it first.
import type { Locator, Page } from "@playwright/test";

/** Open the project drawer if it is closed, and return it. */
export async function openRail(page: Page): Promise<Locator> {
  const show = page.getByRole("button", { name: "Show projects" });
  if ((await show.count()) > 0) await show.click();
  return page.getByRole("navigation", { name: "Projects and pages" });
}

/**
 * Go to the project form the way a reader does (D126): "New project" sits in
 * the projects menu, and before there are any projects the empty state's
 * "Create your first project" link is the way in.
 */
export async function openNewProject(page: Page): Promise<void> {
  const first = page.getByRole("link", { name: /create your first project/i });
  await page.getByRole("button", { name: "Show projects" }).or(first).first().waitFor();
  if ((await first.count()) > 0) {
    await first.click();
    return;
  }
  const rail = await openRail(page);
  await rail.getByRole("link", { name: "New project" }).click();
}
