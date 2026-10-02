// The fit modes live in the floating toolbar's zoom popup (D111), which
// opens on demand and closes after a choice, so a spec reaches a mode the
// way a reader does: open the popup first.
import { expect, type Locator, type Page } from "@playwright/test";

/** The named camera-mode button, opening the zoom popup if it is closed. */
export async function cameraMode(page: Page, name: string): Promise<Locator> {
  const mode = page.getByRole("button", { name, exact: true });
  if ((await mode.count()) === 0) {
    await page.getByRole("button", { name: "Zoom and fit" }).click();
  }
  return mode;
}

/**
 * Expect the named camera mode's pressed state, retrying as any locator
 * assertion does: open the popup, wait for the state, and close it again
 * so the veil never covers the canvas after.
 */
export async function expectModePressed(
  page: Page,
  name: string,
  pressed: "true" | "false",
): Promise<void> {
  const mode = page.getByRole("button", { name, exact: true });
  const wasOpen = (await mode.count()) > 0;
  if (!wasOpen) await page.getByRole("button", { name: "Zoom and fit" }).click();
  await expect(mode).toHaveAttribute("aria-pressed", pressed);
  if (!wasOpen) await page.getByRole("button", { name: "Zoom and fit" }).click();
}
