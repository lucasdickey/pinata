// @vitest-environment jsdom
// The project overview and the navigation around it (D077): the workspace
// opens on one card per capture in page/device order with thumbnails and
// counts; a card opens the canvas and Back returns; the rail lists projects
// and pages only, with the device chosen by a toggle above the canvas; Next
// and Previous pin (and J/K) step through every pin in the project across
// planes and wrap at the project's ends; and the pin table is filtered to
// the capture or widened to the whole project.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PinAnnotationView, ProjectPinAnnotationView } from "../src/lib/annotations";
import { ProjectOverview, overviewCards } from "../src/components/project-overview";
import {
  ProjectWorkspace,
  type AttemptView,
  type DeviceView,
  type WorkspaceProject,
} from "../src/components/project-workspace";
import { installReactFlowMocks } from "./helpers/react-flow";

installReactFlowMocks();

const onChanged = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

function attempt(overrides: Partial<AttemptView> = {}): AttemptView {
  const state = overrides.state ?? "pending";
  return {
    id: "cap-1",
    variant: "desktop",
    attempt: 1,
    state,
    errorCode: null,
    imageHash: null,
    documentWidth: state === "ready" ? 1440 : null,
    documentHeight: state === "ready" ? 8966 : null,
    ...overrides,
  };
}

function device(variant: string, attempts: AttemptView[]): DeviceView {
  const sorted = [...attempts].sort((a, b) => b.attempt - a.attempt);
  const ready = sorted.find((a) => a.state === "ready") ?? null;
  return {
    variant,
    attempts: sorted,
    latest: sorted[0] ?? null,
    selectedCaptureId: ready?.id ?? null,
    selectedAttempt: ready?.attempt ?? null,
    usable: ready !== null,
    retryable: ["ready", "failed", "stale"].includes(sorted[0]?.state ?? ""),
  };
}

/** Chickpea: home (both ready), pricing (Mobile failed), about (Desktop failed). */
function project(): WorkspaceProject {
  return {
    projectId: "p1",
    publicId: "pub1",
    title: "chickpea.co",
    rootUrl: "https://chickpea.co/",
    pages: [
      {
        id: "page-root",
        normalizedUrl: "https://chickpea.co/",
        sortIndex: 0,
        devices: [
          device("desktop", [attempt({ id: "root-d1", state: "ready" })]),
          device("mobile", [attempt({ id: "root-m1", variant: "mobile", state: "ready" })]),
        ],
      },
      {
        id: "page-pricing",
        normalizedUrl: "https://chickpea.co/pricing",
        sortIndex: 1,
        devices: [
          device("desktop", [attempt({ id: "pricing-d1", state: "ready" })]),
          device("mobile", [
            attempt({ id: "pricing-m1", variant: "mobile", state: "failed", errorCode: "total-timeout" }),
          ]),
        ],
      },
      {
        id: "page-about",
        normalizedUrl: "https://chickpea.co/about",
        sortIndex: 2,
        devices: [
          device("desktop", [attempt({ id: "about-d1", state: "failed", errorCode: "dns-failed" })]),
          device("mobile", [attempt({ id: "about-m1", variant: "mobile", state: "ready" })]),
        ],
      },
    ],
    counts: { pages: 3, attempts: 6, ready: 4, failed: 2, inProgress: 0 },
    feedback: { pins: 4, open: 3, resolved: 1, unreadReplies: 2 },
    captureFeedback: {
      "root-d1": { pins: 2, open: 1, resolved: 1, unreadReplies: 2 },
      "root-m1": { pins: 1, open: 1, resolved: 0, unreadReplies: 0 },
      "pricing-d1": { pins: 1, open: 1, resolved: 0, unreadReplies: 0 },
    },
  };
}

function secondProject(): WorkspaceProject {
  return {
    projectId: "p2",
    publicId: "pub2",
    title: "example.com",
    rootUrl: "https://example.com/",
    pages: [
      {
        id: "page-example",
        normalizedUrl: "https://example.com/",
        sortIndex: 0,
        devices: [
          device("desktop", [attempt({ id: "ex-d1", state: "ready" })]),
          device("mobile", [attempt({ id: "ex-m1", variant: "mobile" })]),
        ],
      },
    ],
    counts: { pages: 1, attempts: 2, ready: 1, failed: 0, inProgress: 1 },
  };
}

function pin(
  id: string,
  captureId: string,
  number: number,
  overrides: Partial<PinAnnotationView> = {},
): PinAnnotationView {
  return {
    id,
    captureId,
    kind: "pin",
    number,
    tip: { x: 100 * number, y: 200 * number },
    body: `Note ${id}.`,
    elementSnapshot: null,
    revision: 1,
    status: "open",
    unreadReplies: 0,
    createdAt: 0,
    ...overrides,
  };
}

const pinsByCapture: Record<string, PinAnnotationView[]> = {
  "root-d1": [pin("rd-1", "root-d1", 1, { status: "resolved" }), pin("rd-2", "root-d1", 2)],
  "root-m1": [pin("rm-1", "root-m1", 1)],
  "pricing-d1": [pin("pd-1", "pricing-d1", 1)],
};

const planeInfo: Record<string, Pick<ProjectPinAnnotationView, "pageId" | "normalizedUrl" | "variant">> = {
  "root-d1": { pageId: "page-root", normalizedUrl: "https://chickpea.co/", variant: "desktop" },
  "root-m1": { pageId: "page-root", normalizedUrl: "https://chickpea.co/", variant: "mobile" },
  "pricing-d1": {
    pageId: "page-pricing",
    normalizedUrl: "https://chickpea.co/pricing",
    variant: "desktop",
  },
};

/** The project route's answer: every pin, deliberately not in project order. */
function projectPins(): ProjectPinAnnotationView[] {
  return ["pricing-d1", "root-m1", "root-d1"].flatMap((captureId) =>
    [...pinsByCapture[captureId]!]
      .reverse()
      .map((entry) => ({ ...entry, ...planeInfo[captureId]!, attempt: 1 })),
  );
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  onChanged.mockReset();
  fetchMock = vi.fn((url: unknown) => {
    const target = String(url);
    if (/^\/api\/projects\/[^/]+\/annotations$/.test(target)) {
      return Promise.resolve(json({ annotations: target.includes("pub1") ? projectPins() : [] }));
    }
    if (target.endsWith("/share")) {
      return Promise.resolve(json({ share: { state: "none", version: 0, revokedAt: null } }));
    }
    if (target.includes("/context")) return Promise.resolve(json({ candidates: [] }));
    if (target.endsWith("/thread")) return Promise.resolve(json({ entries: [] }));
    if (/\/(seen|resolve|reopen)$/.test(target)) return Promise.resolve(json({ seen: true }));
    const perCapture = /^\/api\/captures\/([^/]+)\/annotations$/.exec(target);
    if (perCapture) {
      return Promise.resolve(json({ annotations: pinsByCapture[perCapture[1]!] ?? [] }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${target}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tree = () => screen.getByRole("navigation", { name: "Projects and pages" });
const overview = () => screen.getByRole("region", { name: "Project overview" });
const detail = () => screen.getByRole("region", { name: "Selected capture" });
const cards = () => within(overview()).getAllByTestId("overview-card");
const pageButton = (url: string) => within(tree()).getByRole("button", { name: url });
const deviceToggle = () => within(detail()).getByRole("group", { name: "Device" });
const canvasImage = () => within(detail()).getByTestId("capture-stage").querySelector("img");
const panelPin = () => within(detail()).getByTestId("panel-pin");
const stepPosition = () => within(detail()).getByTestId("pin-step-position");

describe("ProjectOverview", () => {
  test("one card per capture, in page order, Desktop then Mobile", () => {
    const list = overviewCards(project());
    expect(list.map((card) => `${card.pageUrl} ${card.variant}`)).toEqual([
      "https://chickpea.co/ desktop",
      "https://chickpea.co/ mobile",
      "https://chickpea.co/pricing desktop",
      "https://chickpea.co/pricing mobile",
      "https://chickpea.co/about desktop",
      "https://chickpea.co/about mobile",
    ]);
    render(<ProjectOverview project={project()} adjustments={{}} onOpenCapture={vi.fn()} />);
    expect(screen.getAllByTestId("overview-card")).toHaveLength(6);
  });

  test("a ready card shows a thumbnail from the authorized asset route, named by page and device", () => {
    render(<ProjectOverview project={project()} adjustments={{}} onOpenCapture={vi.fn()} />);
    const image = screen.getByRole("img", { name: "Mobile capture of https://chickpea.co/" });
    expect(image).toHaveAttribute("src", "/api/captures/root-m1/asset");
    expect(image.getAttribute("src")).not.toMatch(/^[a-z]+:/i);
    expect(image).toHaveClass("overview-thumb");
  });

  test("a capture that is not ready shows its state instead of a thumbnail", () => {
    render(<ProjectOverview project={project()} adjustments={{}} onOpenCapture={vi.fn()} />);
    const failed = screen.getByRole("button", {
      name: "Open Mobile capture of https://chickpea.co/pricing",
    });
    expect(within(failed).queryByRole("img")).toBeNull();
    expect(within(failed).getByTestId("overview-state")).toHaveTextContent("Failed");
    expect(failed).toHaveAttribute("data-ready", "false");
  });

  test("each card carries the page URL, device, state, and the pin, open, and unread counts", () => {
    render(<ProjectOverview project={project()} adjustments={{}} onOpenCapture={vi.fn()} />);
    const home = screen.getByRole("button", { name: "Open Desktop capture of https://chickpea.co/" });
    expect(home).toHaveTextContent("https://chickpea.co/");
    expect(within(home).getByTestId("overview-meta")).toHaveTextContent("Desktop · Ready · v1");
    expect(within(home).getByTestId("overview-counts")).toHaveTextContent("2 pins · 1 open · 2 unread");
    expect(within(home).getByTestId("overview-counts")).toHaveAttribute("data-unread", "true");
    const about = screen.getByRole("button", { name: "Open Mobile capture of https://chickpea.co/about" });
    expect(within(about).getByTestId("overview-counts")).toHaveTextContent("No pins");
    expect(within(about).getByTestId("overview-counts")).toHaveAttribute("data-unread", "false");
  });

  test("local seen adjustments lower a card's unread count", () => {
    render(
      <ProjectOverview project={project()} adjustments={{ "root-d1": 2 }} onOpenCapture={vi.fn()} />,
    );
    const home = screen.getByRole("button", { name: "Open Desktop capture of https://chickpea.co/" });
    expect(within(home).getByTestId("overview-counts")).toHaveTextContent("2 pins · 1 open · 0 unread");
  });

  test("a card reports the capture to open", async () => {
    const user = userEvent.setup();
    const onOpenCapture = vi.fn();
    render(<ProjectOverview project={project()} adjustments={{}} onOpenCapture={onOpenCapture} />);
    await user.click(
      screen.getByRole("button", { name: "Open Desktop capture of https://chickpea.co/pricing" }),
    );
    expect(onOpenCapture).toHaveBeenCalledWith("page-pricing", "desktop");
  });
});

describe("the workspace opens on the overview", () => {
  test("shows the first project's cards and no canvas until a capture is opened", () => {
    render(<ProjectWorkspace projects={[project(), secondProject()]} onChanged={onChanged} />);
    expect(overview()).toBeInTheDocument();
    expect(cards()).toHaveLength(6);
    expect(screen.queryByRole("region", { name: "Selected capture" })).toBeNull();
    expect(document.querySelector(".react-flow")).toBeNull();
    // The project header and its share control sit above the overview.
    expect(within(overview()).getByTestId("project-title")).toHaveTextContent("chickpea.co");
    expect(within(overview()).getByRole("button", { name: "Share with founder" })).toBeInTheDocument();
  });

  test("a card opens its capture in the canvas view, and Back to overview returns", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(
      within(overview()).getByRole("button", { name: "Open Mobile capture of https://chickpea.co/" }),
    );
    expect(detail()).toBeInTheDocument();
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-m1/asset");
    expect(
      within(detail()).getByRole("heading", { name: "Mobile — https://chickpea.co/" }),
    ).toBeInTheDocument();

    await user.click(within(detail()).getByRole("button", { name: "Back to overview" }));
    expect(overview()).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected capture" })).toBeNull();
    expect(cards()).toHaveLength(6);
  });

  test("the overview lists every pin in the project with page and device columns", async () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const table = within(overview()).getByRole("heading", { name: "All pins in this project" });
    expect(table).toBeInTheDocument();
    await waitFor(() => expect(within(overview()).getAllByRole("row")).toHaveLength(5));
    const rows = within(overview()).getAllByRole("row").slice(1);
    // Project order, whatever order the route answered in.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^https:\/\/chickpea\.co\/Desktop v1Pin 1/),
      expect.stringMatching(/^https:\/\/chickpea\.co\/Desktop v1Pin 2/),
      expect.stringMatching(/^https:\/\/chickpea\.co\/Mobile v1Pin 1/),
      expect.stringMatching(/^https:\/\/chickpea\.co\/pricingDesktop v1Pin 1/),
    ]);
    expect(within(overview()).queryByRole("group", { name: "Pins shown" })).toBeNull();
    expect(
      fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => /^\/api\/projects\/.*\/annotations$/.test(url)),
    ).toEqual(["/api/projects/pub1/annotations"]);
  });

  test("a row in the overview table opens the pin's plane with that pin selected", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await waitFor(() => expect(within(overview()).getAllByRole("row")).toHaveLength(5));
    const rows = within(overview()).getAllByRole("row").slice(1);
    await user.click(within(rows[3]!).getByRole("button", { name: /^Pin 1 · “Note pd-1.”/ }));
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/pricing-d1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note pd-1."));
  });
});

describe("the rail", () => {
  test("lists projects and pages only, with the feedback badge summed per page", () => {
    render(<ProjectWorkspace projects={[project(), secondProject()]} onChanged={onChanged} />);
    expect(within(tree()).queryByRole("button", { name: /capture of/ })).toBeNull();
    expect(pageButton("https://chickpea.co/")).toBeInTheDocument();
    expect(pageButton("https://chickpea.co/pricing")).toBeInTheDocument();
    expect(pageButton("https://chickpea.co/about")).toBeInTheDocument();
    const badges = within(tree()).getAllByTestId("feedback-badge");
    // Home: Desktop (2 new · 1 open) plus Mobile (1 open); pricing: 1 open.
    expect(badges.map((badge) => badge.textContent)).toEqual(["2 new · 2 open", "1 open"]);
    expect(badges[0]).toHaveAttribute("aria-label", "https://chickpea.co/: 2 new · 2 open");
    // The overview entry of the shown project is the current one.
    expect(within(tree()).getByRole("button", { name: "Overview of chickpea.co" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("a page opens its Desktop capture, or Mobile when Desktop is not usable, and is marked current", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(pageButton("https://chickpea.co/pricing"));
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/pricing-d1/asset");
    expect(pageButton("https://chickpea.co/pricing")).toHaveAttribute("aria-current", "true");
    expect(within(tree()).getByRole("button", { name: "Overview of chickpea.co" })).not.toHaveAttribute(
      "aria-current",
    );

    await user.click(pageButton("https://chickpea.co/about"));
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/about-m1/asset");
    expect(within(deviceToggle()).getByRole("button", { name: /^Mobile/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const current = within(tree())
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("https://chickpea.co/about");
  });

  test("another project's Overview entry switches the detail area to that project", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project(), secondProject()]} onChanged={onChanged} />);
    await user.click(pageButton("https://chickpea.co/"));
    expect(detail()).toBeInTheDocument();
    await user.click(within(tree()).getByRole("button", { name: "Overview of example.com" }));
    expect(overview()).toBeInTheDocument();
    expect(within(overview()).getByTestId("project-title")).toHaveTextContent("example.com");
    expect(cards()).toHaveLength(2);
    // The project pins are re-read for the newly shown project.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => /^\/api\/projects\/.*\/annotations$/.test(url)),
      ).toEqual(["/api/projects/pub1/annotations", "/api/projects/pub2/annotations"]),
    );
  });
});

describe("the device toggle", () => {
  test("sits above the canvas with exactly one device pressed, and switches the plane", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(pageButton("https://chickpea.co/pricing"));
    const toggle = deviceToggle();
    const desktop = within(toggle).getByRole("button", { name: "Desktop capture of https://chickpea.co/pricing" });
    const mobile = within(toggle).getByRole("button", { name: "Mobile capture of https://chickpea.co/pricing" });
    expect(desktop).toHaveAttribute("aria-pressed", "true");
    expect(mobile).toHaveAttribute("aria-pressed", "false");
    // The device's state is named on the toggle, so a failed sibling is
    // visible without switching to it.
    expect(desktop).toHaveTextContent("Ready");
    expect(mobile).toHaveTextContent("Failed");
    // Above the stage.
    const stage = within(detail()).getByTestId("capture-stage");
    expect(toggle.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(mobile);
    expect(mobile).toHaveAttribute("aria-pressed", "true");
    expect(desktop).toHaveAttribute("aria-pressed", "false");
    expect(within(detail()).getByTestId("capture-stage")).toHaveTextContent("No capture to show yet: Failed.");
    expect(within(detail()).getByRole("alert")).toHaveTextContent(
      "The capture exceeded its total time budget.",
    );
  });
});

describe("cross-capture pin stepping", () => {
  async function openHome(user: ReturnType<typeof userEvent.setup>) {
    await user.click(pageButton("https://chickpea.co/"));
    await waitFor(() => expect(stepPosition()).toHaveTextContent("4 pins in this project"));
  }

  test("Next and Previous pin walk the project in page, device, number order and wrap at the ends", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await openHome(user);
    const next = () => user.click(within(detail()).getByRole("button", { name: "Next pin" }));
    const previous = () => user.click(within(detail()).getByRole("button", { name: "Previous pin" }));

    await next();
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rd-1."));
    // The position line names the mark (D078), then its place in the order.
    expect(stepPosition()).toHaveTextContent("Pin 1 · “Note rd-1.” · 1 of 4");
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-d1/asset");

    await next();
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rd-2."));
    expect(stepPosition()).toHaveTextContent("Pin 2 · “Note rd-2.” · 2 of 4");

    // The last pin of the plane continues onto the next plane, not back to
    // the first pin of this one.
    await next();
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-m1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rm-1."));
    expect(stepPosition()).toHaveTextContent("3 of 4");
    expect(within(deviceToggle()).getByRole("button", { name: /^Mobile/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await next();
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/pricing-d1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note pd-1."));
    expect(pageButton("https://chickpea.co/pricing")).toHaveAttribute("aria-current", "true");

    // Wrap only at the project's end.
    await next();
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-d1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rd-1."));

    // And back the other way, across the project's start.
    await previous();
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/pricing-d1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note pd-1."));
    await previous();
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-m1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rm-1."));
  });

  test("each plane keeps its own camera across a step", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await openHome(user);
    await user.click(within(detail()).getByRole("button", { name: "Natural size" }));
    // Two steps: onto pin 2 here, then onto the Mobile plane.
    await user.click(within(detail()).getByRole("button", { name: "Next pin" }));
    await user.click(within(detail()).getByRole("button", { name: "Next pin" }));
    await user.click(within(detail()).getByRole("button", { name: "Next pin" }));
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-m1/asset");
    await waitFor(() =>
      expect(within(detail()).getByRole("button", { name: "Entire page" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await user.click(within(detail()).getByRole("button", { name: "Previous pin" }));
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-d1/asset");
    await waitFor(() =>
      expect(within(detail()).getByRole("button", { name: "Natural size" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  test("J and K on the canvas step across planes too, and the new plane keeps the keyboard", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await openHome(user);
    const region = () => within(detail()).getByRole("region", { name: /^Screenshot of/ });
    fireEvent.keyDown(region(), { key: "j" });
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rd-1."));
    fireEvent.keyDown(region(), { key: "ArrowDown" });
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rd-2."));
    fireEvent.keyDown(region(), { key: "j" });
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-m1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rm-1."));
    // The keyboard follows the plane switch.
    await waitFor(() => expect(region()).toHaveFocus());
    fireEvent.keyDown(region(), { key: "k" });
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-d1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rd-2."));
    // K from the project's first pin wraps to its last.
    fireEvent.keyDown(region(), { key: "k" });
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rd-1."));
    fireEvent.keyDown(region(), { key: "ArrowUp" });
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/pricing-d1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note pd-1."));
  });

  test("the controls are disabled for a project with no pins", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[secondProject()]} onChanged={onChanged} />);
    await user.click(pageButton("https://example.com/"));
    await waitFor(() => expect(stepPosition()).toHaveTextContent("No pins in this project"));
    expect(within(detail()).getByRole("button", { name: "Next pin" })).toBeDisabled();
    expect(within(detail()).getByRole("button", { name: "Previous pin" })).toBeDisabled();
  });
});

describe("the table scope toggle", () => {
  test("filters to this capture by default and widens to the whole project", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(pageButton("https://chickpea.co/"));
    await waitFor(() =>
      expect(within(detail()).getByRole("heading", { name: "All pins on this capture" })).toBeInTheDocument(),
    );
    const table = () => detail().querySelector(".pin-table") as HTMLElement;
    await waitFor(() => expect(within(table()).getAllByRole("row")).toHaveLength(3));
    const group = within(table()).getByRole("group", { name: "Pins shown" });
    expect(within(group).getByRole("button", { name: "This capture" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(group).getByRole("button", { name: "Whole project" }));
    expect(within(table()).getByRole("heading", { name: "All pins in this project" })).toBeInTheDocument();
    await waitFor(() => expect(within(table()).getAllByRole("row")).toHaveLength(5));
    expect(within(table()).getByRole("columnheader", { name: "Page" })).toBeInTheDocument();
    expect(within(table()).getByRole("columnheader", { name: "Device" })).toBeInTheDocument();

    // A row on another plane switches to it with the pin selected.
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows[2]).toHaveTextContent("Mobile v1");
    await user.click(within(rows[2]!).getByRole("button", { name: /^Pin 1 · “Note rm-1.”/ }));
    expect(canvasImage()).toHaveAttribute("src", "/api/captures/root-m1/asset");
    await waitFor(() => expect(panelPin()).toHaveTextContent("Note rm-1."));
    // The scope is a view preference: it survives a page switch inside the
    // project, and the widened table follows to the new plane.
    await user.click(pageButton("https://chickpea.co/pricing"));
    expect(within(detail()).getByRole("heading", { name: "All pins in this project" })).toBeInTheDocument();
    await waitFor(() => expect(within(table()).getAllByRole("row")).toHaveLength(5));
    await user.click(within(table()).getByRole("button", { name: "This capture" }));
    expect(within(detail()).getByRole("heading", { name: "All pins on this capture" })).toBeInTheDocument();
    await waitFor(() => expect(within(table()).getAllByRole("row")).toHaveLength(2));
  });

  test("Copy all in project scope writes the project export with one heading per capture", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(pageButton("https://chickpea.co/"));
    await user.click(within(detail()).getByRole("button", { name: "Whole project" }));
    await waitFor(() => expect(within(detail()).getAllByRole("row")).toHaveLength(5));
    await user.click(within(detail()).getByRole("button", { name: "Copy all as Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const markdown = writeText.mock.calls[0]![0] as string;
    expect(markdown.split("\n")[0]).toBe("# Pinata pins — chickpea.co");
    expect(markdown.split("\n").filter((line) => line.startsWith("## "))).toEqual([
      "## https://chickpea.co/ — Desktop",
      "## https://chickpea.co/ — Mobile",
      "## https://chickpea.co/pricing — Desktop",
    ]);
    expect(markdown).toContain("### Pin 2 · “Note rd-2.”");
    expect(markdown).toContain("- Position: 200, 400 px natural");
    // The zoom readout is an <output> (also a status), so address the table's own.
    expect(detail().querySelector(".pin-table-actions [role='status']")).toHaveTextContent(
      "Copied 4 pins as Markdown.",
    );
  });
});
