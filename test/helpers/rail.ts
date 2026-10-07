// The project drawer (D106) starts closed and closes itself after a choice,
// so a test reaches the rail the way a reader does: open it first.
import { fireEvent, screen, within } from "@testing-library/react";

/** Open the project drawer if it is closed, and return it. */
export function openRail(): HTMLElement {
  const show = screen.queryByRole("button", { name: "Show projects" });
  if (show) fireEvent.click(show);
  return screen.getByRole("navigation", { name: "Projects" });
}

/**
 * Open a page the way a reader does since D128: the projects menu lists
 * projects only, so pick the page's project there, then its card in the
 * project's overview — the first ready device, as the workspace prefers.
 */
export function openPageFromMenu(url: string): void {
  const count = within(openRail()).getAllByRole("button", { name: /.+/ }).filter((button) =>
    button.classList.contains("project-switch"),
  ).length;
  for (let index = 0; index < count; index += 1) {
    const switches = within(openRail())
      .getAllByRole("button")
      .filter((button) => button.classList.contains("project-switch"));
    fireEvent.click(switches[index]!);
    const cards = screen
      .queryAllByRole("button", { name: new RegExp(`^Open \\w+ capture of ${escape(url)}$`) })
      .filter((card) => card.classList.contains("overview-card"));
    if (cards.length > 0) {
      fireEvent.click(cards.find((card) => card.dataset.ready === "true") ?? cards[0]!);
      return;
    }
  }
  throw new Error(`No project has a page ${url}`);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
