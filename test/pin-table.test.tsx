// @vitest-environment jsdom
// The all-pins table below the canvas (D071). The side panel can only ever
// show one pin, which is useless for the job this table exists for: handing
// every note on a page to an agentic IDE in one paste. So the table has to
// show all of them at once, keep selection wired to the rest of the
// workspace, and put the same content on the clipboard.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PinAnnotationView, PinElementSnapshot } from "../src/lib/annotations";
import { formatPinsAsMarkdown } from "../src/lib/pin-export";
import { PinTable } from "../src/components/pin-table";

const element: PinElementSnapshot = {
  id: "el-1",
  kind: "button",
  tag: "button",
  role: "switch",
  text: "Annual (save 20%)",
  accessibleName: "Annual (save 20%)",
  hints: { id: "", classes: [], alt: "", title: "", testId: "" },
  path: ["main", "section.pricing", "div.billing-toggle"],
  rect: { x: 380, y: 372, width: 176, height: 44 },
};

const pins: PinAnnotationView[] = [
  {
    id: "a1",
    captureId: "cap-1",
    kind: "pin",
    number: 1,
    tip: { x: 392, y: 386 },
    body: "This billing toggle reads the same in both states.",
    elementSnapshot: element,
    revision: 1,
    createdAt: 0,
  },
  {
    id: "a2",
    captureId: "cap-1",
    kind: "pin",
    number: 2,
    tip: { x: 640, y: 902 },
    body: "The CTA disappears below the fold.",
    elementSnapshot: null,
    revision: 1,
    createdAt: 1,
  },
];

const context = { pageUrl: "https://chickpea.co/pricing", variant: "Desktop", attempt: 2 };

let writeText: ReturnType<typeof vi.fn>;

/**
 * user-event installs its own clipboard stub during setup, so the spy has to
 * be planted afterwards or the component writes to user-event's copy and the
 * assertions see nothing.
 */
function installClipboard() {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderTable(overrides: Partial<Parameters<typeof PinTable>[0]> = {}) {
  const onSelectPin = vi.fn();
  render(
    <PinTable
      pins={pins}
      status="ready"
      context={context}
      selectedPinId={null}
      onSelectPin={onSelectPin}
      {...overrides}
    />,
  );
  return { onSelectPin };
}

describe("the all-pins table", () => {
  test("lists every pin with its position, element context, and comment", () => {
    renderTable();
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(rows).toHaveLength(2);

    expect(within(rows[0]!).getByRole("button", { name: "Pin 1" })).toBeInTheDocument();
    expect(rows[0]!).toHaveTextContent("392, 386");
    expect(rows[0]!).toHaveTextContent("main > section.pricing > div.billing-toggle");
    expect(rows[0]!).toHaveTextContent("This billing toggle reads the same in both states.");

    // A pin saved against no element says so rather than showing a blank cell.
    expect(rows[1]!).toHaveTextContent("No element");
  });

  test("selecting a row reports the pin, and selecting it again clears it", async () => {
    const user = userEvent.setup();
    const { onSelectPin } = renderTable();
    await user.click(screen.getByRole("button", { name: "Pin 1" }));
    expect(onSelectPin).toHaveBeenCalledWith("a1");

    cleanup();
    const second = renderTable({ selectedPinId: "a1" });
    await user.click(screen.getByRole("button", { name: "Pin 1" }));
    expect(second.onSelectPin).toHaveBeenCalledWith(null);
  });

  test("the selected row is marked, not merely colored", () => {
    renderTable({ selectedPinId: "a2" });
    expect(screen.getByRole("button", { name: "Pin 2" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Pin 1" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("Copy all writes exactly the shared Markdown rendering and confirms", async () => {
    const user = userEvent.setup();
    installClipboard();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Copy all as Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toBe(formatPinsAsMarkdown(pins, context));
    expect(screen.getByRole("status")).toHaveTextContent("Copied 2 pins as Markdown.");
  });

  test("a clipboard the browser will not grant is reported, not swallowed", async () => {
    const user = userEvent.setup();
    installClipboard().mockRejectedValueOnce(new Error("denied"));
    renderTable();
    await user.click(screen.getByRole("button", { name: "Copy all as Markdown" }));
    // The table text stays selectable, so the failure message points there
    // rather than leaving the reader with a button that did nothing.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/select the table text/i),
    );
  });

  test("there is nothing to copy on an empty capture", () => {
    renderTable({ pins: [] });
    expect(screen.getByRole("button", { name: "Copy all as Markdown" })).toBeDisabled();
    expect(screen.getByText(/No pins yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("loading and failed reads are announced instead of showing an empty table", () => {
    renderTable({ pins: [], status: "loading" });
    expect(screen.getByText(/Loading pins/)).toBeInTheDocument();
    cleanup();
    renderTable({ pins: [], status: "failed" });
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
  });
});
