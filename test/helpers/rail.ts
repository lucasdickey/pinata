// The project drawer (D106) starts closed and closes itself after a choice,
// so a test reaches the rail the way a reader does: open it first.
import { fireEvent, screen } from "@testing-library/react";

/** Open the project drawer if it is closed, and return it. */
export function openRail(): HTMLElement {
  const show = screen.queryByRole("button", { name: "Show projects" });
  if (show) fireEvent.click(show);
  return screen.getByRole("navigation", { name: "Projects and pages" });
}
