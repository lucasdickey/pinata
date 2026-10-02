// The fit modes live in the floating toolbar's zoom popup (D111), which
// opens on demand and closes after a choice, so a test reaches a mode the
// way a reader does: open the popup first.
import { fireEvent, waitFor, within } from "@testing-library/react";

/** The named camera-mode button inside `scope`, opening the zoom popup if needed. */
export function cameraMode(scope: HTMLElement, name: string): HTMLElement {
  const open = within(scope).queryByRole("button", { name });
  if (open) return open;
  fireEvent.click(within(scope).getByRole("button", { name: "Zoom and fit" }));
  return within(scope).getByRole("button", { name });
}

/**
 * Whether the named camera mode is pressed ("true"/"false"), read the way a
 * reader checks it: open the popup, look, and close it again, so the check
 * leaves nothing open behind it.
 */
export function modePressed(scope: HTMLElement, name: string): string | null {
  const wasOpen = within(scope).queryByRole("button", { name }) !== null;
  const pressed = cameraMode(scope, name).getAttribute("aria-pressed");
  if (!wasOpen) fireEvent.click(within(scope).getByRole("button", { name: "Zoom and fit" }));
  return pressed;
}

/**
 * Wait until the named camera mode is pressed. Opens the popup once, waits,
 * and closes it again; never toggles inside the wait, since each toggle is
 * a DOM change that would re-run the wait forever.
 */
export async function waitForMode(scope: HTMLElement, name: string): Promise<void> {
  const wasOpen = within(scope).queryByRole("button", { name }) !== null;
  const mode = cameraMode(scope, name);
  await waitFor(() => {
    if (mode.getAttribute("aria-pressed") !== "true") throw new Error(`${name} is not pressed`);
  });
  if (!wasOpen) fireEvent.click(within(scope).getByRole("button", { name: "Zoom and fit" }));
}
