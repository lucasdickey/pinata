// The project drawer (D106) starts closed and closes itself after a choice,
// so a spec reaches the rail the way a reader does: open it first.
import { expect, type Locator, type Page } from "@playwright/test";

/** Open the project drawer if it is closed, and return it. */
export async function openRail(page: Page): Promise<Locator> {
  const show = page.getByRole("button", { name: "Show projects" });
  const rail = page.getByRole("navigation", { name: "Projects" });
  // Wait for the workspace to render one or the other: right after a load
  // the list is still arriving, and deciding too early skipped the click.
  await expect(show.or(rail).first()).toBeVisible();
  if (await show.isVisible()) await show.click();
  return rail;
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The page's card in the project overview on screen, ready device first. */
async function overviewCard(page: Page, url: string): Promise<Locator | null> {
  const cards = page.locator(`button.overview-card[aria-label$=" capture of ${url}"]`);
  if ((await cards.count()) === 0) return null;
  const ready = cards.and(page.locator('[data-ready="true"]'));
  return (await ready.count()) > 0 ? ready.first() : cards.first();
}

/**
 * Open a page the way a reader does since D128: the projects menu lists
 * projects only, so pick the page's project there (or stay in the one on
 * screen), then the page's card in that project's overview — on its ready
 * device first, as the workspace prefers.
 */
export async function openPageFromMenu(page: Page, url: string, projectTitle?: string): Promise<void> {
  const switches = async () => (await openRail(page)).locator("button.project-switch");
  if (projectTitle) {
    await (await switches())
      .filter({ has: page.locator(".project-switch-name", { hasText: new RegExp(`^${escapeRegExp(projectTitle)}$`) }) })
      .first()
      .click();
  } else {
    const back = page.getByRole("button", { name: "Back to overview" });
    if ((await back.count()) > 0) await back.click();
  }
  let card = await overviewCard(page, url);
  if (!card && !projectTitle) {
    const total = await (await switches()).count();
    await page.keyboard.press("Escape");
    for (let index = 0; index < total && !card; index += 1) {
      await (await switches()).nth(index).click();
      card = await overviewCard(page, url);
    }
  }
  if (!card) throw new Error(`No project overview has a page ${url}`);
  await card.click();
}
