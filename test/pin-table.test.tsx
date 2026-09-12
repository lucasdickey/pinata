// @vitest-environment jsdom
// The all-pins table below the canvas (D071), project-scoped since D077. The
// side panel can only ever show one pin, which is useless for the job this
// table exists for: handing every note to an agentic IDE in one paste. So
// the table has to show all of them at once with the page and device that
// make a per-capture number unambiguous, keep selection wired to the rest
// of the workspace, offer the capture/project scope toggle, and put the
// same content on the clipboard.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  PinAnnotationView,
  PinElementSnapshot,
  RectangleAnnotationView,
} from "../src/lib/annotations";
import { PinTable, type PinTableRow } from "../src/components/pin-table";

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
    status: "replied",
    unreadReplies: 2,
    createdAt: 0,
  },
  {
    id: "a2",
    captureId: "cap-2",
    kind: "pin",
    number: 1,
    tip: { x: 640, y: 902 },
    body: "The CTA disappears below the fold.",
    elementSnapshot: null,
    revision: 1,
    status: "resolved",
    unreadReplies: 0,
    createdAt: 1,
  },
];

const rows: PinTableRow[] = [
  { pin: pins[0]!, pageUrl: "https://chickpea.co/pricing", variant: "Desktop", attempt: 2 },
  { pin: pins[1]!, pageUrl: "https://chickpea.co/pricing", variant: "Mobile", attempt: 1 },
];

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
  const markdown = vi.fn(() => "# rendered markdown");
  render(
    <PinTable
      rows={rows}
      status="ready"
      heading="All pins on this capture"
      markdown={markdown}
      selectedPinId={null}
      onSelectPin={onSelectPin}
      {...overrides}
    />,
  );
  return { onSelectPin, markdown };
}

describe("the all-pins table", () => {
  test("lists every pin with its page, device, position, element context, and comment", () => {
    renderTable();
    const tableRows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(tableRows).toHaveLength(2);

    expect(within(tableRows[0]!).getByRole("button", { name: "Pin 1" })).toBeInTheDocument();
    expect(tableRows[0]!).toHaveTextContent("https://chickpea.co/pricing");
    expect(tableRows[0]!).toHaveTextContent("Desktop v2");
    expect(tableRows[0]!).toHaveTextContent("392, 386");
    expect(tableRows[0]!).toHaveTextContent("main > section.pricing > div.billing-toggle");
    expect(tableRows[0]!).toHaveTextContent("This billing toggle reads the same in both states.");

    // Two pins can share a number across captures (D077); the Device
    // column is what tells them apart.
    expect(within(tableRows[1]!).getByRole("button", { name: "Pin 1" })).toBeInTheDocument();
    expect(tableRows[1]!).toHaveTextContent("Mobile v1");
    // A pin saved against no element says so rather than showing a blank cell.
    expect(tableRows[1]!).toHaveTextContent("No element");
  });

  test("carries Page and Device columns before the pin number (D077)", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual(["Page", "Device", "Pin", "Status", "Position", "Element", "Comment"]);
  });

  test("carries a Status column with the lifecycle state and the unread marker (D075)", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    const tableRows = screen.getAllByRole("row").slice(1);
    const status = (row: HTMLElement) => row.querySelector(".pin-table-status")!;
    expect(status(tableRows[0]!)).toHaveTextContent("Replied · 2 new");
    expect(status(tableRows[0]!)).toHaveAttribute("data-status", "replied");
    expect(status(tableRows[1]!)).toHaveTextContent("Resolved");
    expect(status(tableRows[1]!)).not.toHaveTextContent("new");
  });

  test("selecting a row reports the pin, and selecting it again clears it", async () => {
    const user = userEvent.setup();
    const { onSelectPin } = renderTable();
    await user.click(screen.getAllByRole("button", { name: "Pin 1" })[0]!);
    expect(onSelectPin).toHaveBeenCalledWith("a1");

    cleanup();
    const second = renderTable({ selectedPinId: "a1" });
    await user.click(screen.getAllByRole("button", { name: "Pin 1" })[0]!);
    expect(second.onSelectPin).toHaveBeenCalledWith(null);
  });

  test("the selected row is marked, not merely colored", () => {
    renderTable({ selectedPinId: "a2" });
    const buttons = screen.getAllByRole("button", { name: "Pin 1" });
    expect(buttons[1]).toHaveAttribute("aria-current", "true");
    expect(buttons[0]).not.toHaveAttribute("aria-current");
  });

  test("Copy all writes exactly the Markdown the workspace renders and confirms", async () => {
    const user = userEvent.setup();
    installClipboard();
    const { markdown } = renderTable();
    await user.click(screen.getByRole("button", { name: "Copy all as Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(markdown).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toBe("# rendered markdown");
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
    renderTable({ rows: [], scope: { value: "capture", onChange: vi.fn() } });
    expect(screen.getByRole("button", { name: "Copy all as Markdown" })).toBeDisabled();
    expect(screen.getByText(/No pins yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("an empty project says so rather than inviting a click on a page that is not open", () => {
    renderTable({ rows: [], heading: "All pins in this project" });
    expect(screen.getByText("No pins in this project yet.")).toBeInTheDocument();
  });

  test("loading and failed reads are announced instead of showing an empty table", () => {
    renderTable({ rows: [], status: "loading" });
    expect(screen.getByText(/Loading pins/)).toBeInTheDocument();
    cleanup();
    renderTable({ rows: [], status: "failed" });
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
  });

  describe("scope toggle (D077)", () => {
    test("offers This capture and Whole project with exactly one pressed, and reports a change", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderTable({ scope: { value: "capture", onChange } });
      const group = screen.getByRole("group", { name: "Pins shown" });
      const capture = within(group).getByRole("button", { name: "This capture" });
      const project = within(group).getByRole("button", { name: "Whole project" });
      expect(capture).toHaveAttribute("aria-pressed", "true");
      expect(project).toHaveAttribute("aria-pressed", "false");
      await user.click(project);
      expect(onChange).toHaveBeenCalledWith("project");
    });

    test("is absent when only the whole project applies", () => {
      renderTable({ heading: "All pins in this project" });
      expect(screen.queryByRole("group", { name: "Pins shown" })).toBeNull();
      expect(screen.getByRole("heading", { name: "All pins in this project" })).toBeInTheDocument();
    });
  });
});

describe("rectangles in the table (D079)", () => {
  const box: RectangleAnnotationView = {
    id: "a3",
    captureId: "cap-1",
    kind: "rectangle",
    number: 3,
    rect: { x: 120.4, y: 640.6, width: 300.2, height: 180.5 },
    body: "This whole card needs more air.",
    elementSnapshot: element,
    revision: 1,
    status: "open",
    unreadReplies: 0,
    createdAt: 2,
  };
  // A project-scoped row (D077): the box sits on another page's capture.
  const mixed: PinTableRow[] = [
    ...rows,
    { pin: box, pageUrl: "https://chickpea.co/", variant: "Mobile", attempt: 3 },
  ];

  test("a box row names the kind, its page and device, and shows its corner and size", async () => {
    const user = userEvent.setup();
    const { onSelectPin } = renderTable({ rows: mixed, heading: "All pins in this project" });
    const tableRows = screen.getAllByRole("row").slice(1);
    expect(tableRows).toHaveLength(3);
    const row = tableRows[2]!;
    expect(within(row).getByRole("button", { name: "Box 3" })).toBeInTheDocument();
    expect(row).toHaveTextContent("https://chickpea.co/");
    expect(row).toHaveTextContent("Mobile v3");
    const position = row.querySelector(".pin-table-position")!;
    expect(position).toHaveAttribute("data-kind", "rectangle");
    expect(position).toHaveTextContent("120, 641 · 300 × 181");
    expect(row).toHaveTextContent("This whole card needs more air.");
    // Pin rows are unchanged beside it.
    expect(tableRows[0]!.querySelector(".pin-table-position")).toHaveTextContent("392, 386");
    expect(tableRows[0]!.querySelector(".pin-table-position")).toHaveAttribute("data-kind", "pin");
    await user.click(within(row).getByRole("button", { name: "Box 3" }));
    expect(onSelectPin).toHaveBeenCalledWith("a3");
  });

  test("Copy all counts the box among the rows it hands to the Markdown renderer", async () => {
    const user = userEvent.setup();
    installClipboard();
    const { markdown } = renderTable({ rows: mixed, heading: "All pins in this project" });
    await user.click(screen.getByRole("button", { name: "Copy all as Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(markdown).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Copied 3 pins as Markdown.");
  });
});
