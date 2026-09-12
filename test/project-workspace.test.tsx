// @vitest-environment jsdom
// The project/page/device navigation surface (VAL-PROJECT-003,
// VAL-PROJECT-005): pages listed only under their owning project in submitted
// order, Desktop and Mobile per page, exactly one active item, partial
// statuses that keep successful siblings usable, retry offered only for a
// terminal or stale attempt, deterministic newest-first version selection,
// and a screenshot stage that cannot navigate.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
    // The canvas sizes its screenshot parent from these persisted document
    // dimensions; non-ready attempts have none.
    documentWidth: state === "ready" ? 1440 : null,
    documentHeight: state === "ready" ? 8966 : null,
    ...overrides,
  };
}

function device(variant: string, attempts: AttemptView[]): DeviceView {
  const ready = [...attempts].filter((a) => a.state === "ready").sort((a, b) => b.attempt - a.attempt)[0];
  const sorted = [...attempts].sort((a, b) => b.attempt - a.attempt);
  return {
    variant,
    attempts: sorted,
    latest: sorted[0] ?? null,
    selectedCaptureId: ready?.id ?? null,
    selectedAttempt: ready?.attempt ?? null,
    usable: Boolean(ready),
    retryable: ["ready", "failed", "stale"].includes(sorted[0]?.state ?? ""),
  };
}

function project(overrides: Partial<WorkspaceProject> = {}): WorkspaceProject {
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
            attempt({
              id: "pricing-m1",
              variant: "mobile",
              state: "failed",
              errorCode: "total-timeout",
            }),
          ]),
        ],
      },
    ],
    counts: { pages: 2, attempts: 4, ready: 3, failed: 1, inProgress: 0 },
    ...overrides,
  };
}

const secondProject = (): WorkspaceProject => ({
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
        device("desktop", [attempt({ id: "ex-d1" })]),
        device("mobile", [attempt({ id: "ex-m1", variant: "mobile" })]),
      ],
    },
  ],
  counts: { pages: 1, attempts: 2, ready: 0, failed: 0, inProgress: 2 },
});

/** JSON response helper for the fetch stubs. */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  onChanged.mockReset();
  // The annotations list and the draft's nearby-context candidates are
  // per-plane reads every selection makes; the default plane has no pins
  // and no nearby elements. Tests that exercise writes override this.
  fetchMock = vi.fn((url: unknown) => {
    const target = String(url);
    if (target.includes("/context")) {
      return Promise.resolve(json({ candidates: [] }));
    }
    if (target.includes("/annotations")) {
      return Promise.resolve(json({ annotations: [] }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${target}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

/** Flush the annotations load the first ready selection triggers. */
async function settleAnnotations() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tree = () => screen.getByRole("navigation", { name: "Projects, pages, and devices" });
const detail = () => screen.getByRole("region", { name: "Selected capture" });
// Two surfaces now list every pin: the side panel (one selection at a time)
// and the all-pins table below the canvas (D071). Pin queries have to name
// which one they mean, or every pin matches twice.
const sidePanel = () => within(detail()).getByTestId("capture-panel");

describe("hierarchy", () => {
  test("lists each page only under its owning project, in submitted order", () => {
    render(<ProjectWorkspace projects={[project(), secondProject()]} onChanged={onChanged} />);
    const projectItems = within(tree()).getAllByRole("listitem", { name: undefined });
    // Project headings appear once each, with their own page lists beneath.
    const lists = within(tree()).getAllByRole("list");
    const chickpeaPages = within(lists[1]!).getAllByText(/chickpea\.co/);
    expect(chickpeaPages.map((node) => node.textContent)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
    ]);
    expect(within(tree()).queryAllByText("https://example.com/")).toHaveLength(1);
    expect(projectItems.length).toBeGreaterThan(0);
    // No page from project two leaked into project one's list.
    expect(within(lists[1]!).queryByText("https://example.com/")).toBeNull();
  });

  test("every page exposes Desktop and Mobile", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    expect(within(tree()).getAllByRole("button", { name: /^Desktop capture of/ })).toHaveLength(2);
    expect(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })).toHaveLength(2);
  });

  test("exactly one page/device is active, and selecting another moves it", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const current = () =>
      within(tree())
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-current") === "true");
    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveAccessibleName(/^Desktop capture of/);

    await user.click(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!);
    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveAccessibleName(/^Mobile capture of/);
    expect(
      within(detail()).getByRole("heading", { name: "Mobile — https://chickpea.co/pricing" }),
    ).toBeInTheDocument();
  });
});

describe("partial status", () => {
  test("a failed device is labelled while its successful siblings stay ready", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const buttons = within(tree()).getAllByRole("button");
    const labels = buttons.map((button) => button.textContent);
    expect(labels.filter((label) => label?.includes("Ready"))).toHaveLength(3);
    expect(labels.filter((label) => label?.includes("Failed"))).toHaveLength(1);
  });

  test("the selected failed device shows its bounded outcome message", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!);
    expect(within(detail()).getByRole("alert")).toHaveTextContent(
      "The capture exceeded its total time budget.",
    );
  });

  test("an older ready capture stays selected while a newer attempt is queued", async () => {
    const user = userEvent.setup();
    const withRetryInFlight = project();
    withRetryInFlight.pages[1]!.devices[1] = device("mobile", [
      attempt({ id: "m1", variant: "mobile", attempt: 1, state: "ready" }),
      attempt({ id: "m2", variant: "mobile", attempt: 2, state: "pending" }),
    ]);
    render(<ProjectWorkspace projects={[withRetryInFlight]} onChanged={onChanged} />);
    await user.click(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!);

    const versions = within(detail()).getByRole("list", { name: "Capture versions" });
    expect(within(versions).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Version 2 — Queued",
      "Version 1 — Ready (default)",
    ]);
    // The older ready version is what renders while the retry is queued.
    expect(await within(detail()).findByRole("img")).toHaveAttribute(
      "src",
      "/api/captures/m1/asset",
    );
  });

  test("a newer ready version becomes the default over the older one", async () => {
    const user = userEvent.setup();
    const recaptured = project();
    recaptured.pages[0]!.devices[0] = device("desktop", [
      attempt({ id: "d1", attempt: 1, state: "ready" }),
      attempt({ id: "d2", attempt: 2, state: "ready" }),
    ]);
    render(<ProjectWorkspace projects={[recaptured]} onChanged={onChanged} />);
    const versions = within(detail()).getByRole("list", { name: "Capture versions" });
    const buttons = within(versions).getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Version 2 — Ready (default)");
    expect(buttons[0]!.getAttribute("aria-current")).toBe("true");
    // The older version stays addressable, and selecting it renders its image.
    await user.click(buttons[1]!);
    expect(await within(detail()).findByRole("img")).toHaveAttribute(
      "src",
      "/api/captures/d1/asset",
    );
  });
});

describe("capture canvas stage (VAL-CAPTURE-015, VAL-CANVAS-002)", () => {
  test("a ready capture renders through the authorized same-origin asset route", async () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const stage = within(detail()).getByTestId("capture-stage");
    const image = await within(stage).findByRole("img");
    // The authorized editor-session route only: same-origin, never a public
    // or cross-origin (provider) URL.
    expect(image).toHaveAttribute("src", "/api/captures/root-d1/asset");
    expect(image.getAttribute("src")).not.toMatch(/^[a-z]+:/i);
  });

  test("the image's accessible name carries page URL, device, and attempt", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    expect(await within(detail()).findByRole("img")).toHaveAccessibleName(
      "Screenshot of https://chickpea.co/ (Desktop, version 1)",
    );

    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    expect(await within(detail()).findByRole("img")).toHaveAccessibleName(
      "Screenshot of https://chickpea.co/ (Mobile, version 1)",
    );
  });

  test("the image renders at natural document dimensions inside a named canvas region", async () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const stage = within(detail()).getByTestId("capture-stage");
    // The canvas region carries the capture's accessible name; pan/zoom
    // replaces the old scroll region.
    const region = within(stage).getByRole("region", {
      name: "Screenshot of https://chickpea.co/ (Desktop, version 1)",
    });
    const image = await within(region).findByRole("img");
    // Intrinsic natural dimensions, persisted on the capture, with no
    // constraint class that would scale or crop it inside the node.
    expect(image).toHaveAttribute("width", "1440");
    expect(image).toHaveAttribute("height", "8966");
    expect(image.className).toBe("capture-frame-image");
  });

  test.each([
    ["pending", "Queued"],
    ["capturing", "Capturing"],
    ["stale", "Stopped responding"],
    ["failed", "Failed"],
  ] as const)(
    "a device with only a %s attempt renders no image and keeps its named state",
    (state, label) => {
      const notReady = project();
      notReady.pages[0]!.devices[0] = device("desktop", [
        attempt({
          id: "d1",
          state,
          errorCode: state === "failed" ? "total-timeout" : null,
        }),
      ]);
      render(<ProjectWorkspace projects={[notReady]} onChanged={onChanged} />);
      const stage = within(detail()).getByTestId("capture-stage");
      expect(within(stage).queryByRole("img")).toBeNull();
      expect(stage).toHaveTextContent("No capture to show yet:");
      // The state is named on the device row itself.
      expect(
        within(tree()).getByRole("button", {
          name: "Desktop capture of https://chickpea.co/",
        }),
      ).toHaveTextContent(label);
    },
  );

  test("explicitly selecting a non-ready version swaps the canvas for its named state", async () => {
    const user = userEvent.setup();
    const mixed = project();
    mixed.pages[0]!.devices[0] = device("desktop", [
      attempt({ id: "d1", attempt: 1, state: "ready" }),
      attempt({ id: "d2", attempt: 2, state: "failed", errorCode: "total-timeout" }),
    ]);
    render(<ProjectWorkspace projects={[mixed]} onChanged={onChanged} />);
    // The ready default renders its image.
    expect(await within(detail()).findByRole("img")).toHaveAttribute(
      "src",
      "/api/captures/d1/asset",
    );

    const versions = within(detail()).getByRole("list", { name: "Capture versions" });
    await user.click(within(versions).getByRole("button", { name: /Version 2 — Failed/ }));
    const stage = within(detail()).getByTestId("capture-stage");
    expect(within(stage).queryByRole("img")).toBeNull();
    expect(stage).toHaveTextContent("No capture to show yet: Failed.");
  });
});

describe("camera modes (VAL-CANVAS-002)", () => {
  test("the initial camera is the named entire-capture (contain) mode", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    // User-directed 2026-09-09: "it should be presented such that the entire
    // page is in view". Contain is the pressed default; width-fit and
    // natural-size remain reachable named modes.
    expect(within(detail()).getByRole("button", { name: "Entire page" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(detail()).getByRole("button", { name: "Fit width" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(detail()).getByRole("button", { name: "Natural size" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("each named mode is reachable and exactly one is pressed", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const entire = within(detail()).getByRole("button", { name: "Entire page" });
    const width = within(detail()).getByRole("button", { name: "Fit width" });
    const natural = within(detail()).getByRole("button", { name: "Natural size" });

    await user.click(width);
    expect(width).toHaveAttribute("aria-pressed", "true");
    expect(entire).toHaveAttribute("aria-pressed", "false");
    expect(natural).toHaveAttribute("aria-pressed", "false");

    await user.click(natural);
    expect(natural).toHaveAttribute("aria-pressed", "true");
    expect(width).toHaveAttribute("aria-pressed", "false");

    await user.click(entire);
    expect(entire).toHaveAttribute("aria-pressed", "true");
    expect(natural).toHaveAttribute("aria-pressed", "false");
  });

  test("changing the selected capture resets the camera to entire-in-view", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(within(detail()).getByRole("button", { name: "Natural size" }));
    expect(
      within(detail()).getByRole("button", { name: "Natural size" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    expect(within(detail()).getByRole("button", { name: "Entire page" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(detail()).getByRole("button", { name: "Natural size" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Switching versions of the same device resets too.
    const mixed = project();
    mixed.pages[0]!.devices[0] = device("desktop", [
      attempt({ id: "d1", attempt: 1, state: "ready" }),
      attempt({ id: "d2", attempt: 2, state: "ready" }),
    ]);
    cleanup();
    render(<ProjectWorkspace projects={[mixed]} onChanged={onChanged} />);
    await user.click(within(detail()).getByRole("button", { name: "Fit width" }));
    const versions = within(detail()).getByRole("list", { name: "Capture versions" });
    await user.click(within(versions).getByRole("button", { name: /Version 1 — Ready/ }));
    expect(within(detail()).getByRole("button", { name: "Entire page" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("zoom controls and a live zoom readout sit with the mode buttons", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    expect(within(detail()).getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(within(detail()).getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(within(detail()).getByLabelText("Current zoom")).toHaveTextContent(/%$/);
  });

  test("one short line under the canvas names the three verbs (VAL-CANVAS-009, D074)", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    // Plain words, no modes, no jargon: the page teaches the whole workflow
    // in one line, and there is no toggle anywhere to find first.
    const hint = detail().querySelector(".workspace-hint") as HTMLElement;
    expect(hint).not.toBeNull();
    expect(hint).toHaveTextContent(/click the page to drop a pin/i);
    expect(hint).toHaveTextContent(/drag a pin to move it/i);
    expect(hint).toHaveTextContent(/click a pin to read or reply/i);
    expect(hint.textContent!.length).toBeLessThan(120);
    const lower = hint.textContent!.toLowerCase();
    for (const jargon of ["mode", "navigate", "canvas update", "natural pixel"]) {
      expect(lower).not.toContain(jargon);
    }
    expect(within(detail()).queryByRole("button", { name: /place pin|navigate/i })).toBeNull();
    // Under the canvas, not above it.
    const stage = within(detail()).getByTestId("capture-stage");
    expect(stage.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("the hint is not shown for a capture that cannot be pinned", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!);
    expect(detail().querySelector(".workspace-hint")).toBeNull();
  });

  test("each plane keeps its own camera for the session", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(within(detail()).getByRole("button", { name: "Natural size" }));
    expect(within(detail()).getByRole("button", { name: "Natural size" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // An unvisited plane still opens in the entire-capture initial camera.
    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    await waitFor(() =>
      expect(within(detail()).getByRole("button", { name: "Entire page" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    // Returning to the first plane restores its own camera, not the other's.
    await user.click(
      within(tree()).getByRole("button", { name: "Desktop capture of https://chickpea.co/" }),
    );
    await waitFor(() =>
      expect(within(detail()).getByRole("button", { name: "Natural size" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });
});

describe("screen-fixed selection and metadata panel", () => {
  test("shows the synchronized empty selection and the active capture's identity", () => {
    const identified = project();
    identified.pages[0]!.devices[0] = device("desktop", [
      attempt({ id: "root-d1", state: "ready", imageHash: "a3d087b2cafe".repeat(5).slice(0, 64) }),
    ]);
    render(<ProjectWorkspace projects={[identified]} onChanged={onChanged} />);
    const panel = within(detail()).getByTestId("capture-panel");
    expect(within(panel).getByText("Nothing selected.")).toBeInTheDocument();
    expect(panel).toHaveTextContent("https://chickpea.co/");
    expect(panel).toHaveTextContent("Desktop");
    expect(panel).toHaveTextContent("v1");
    expect(panel).toHaveTextContent("1440 × 8966 px");
    expect(panel).toHaveTextContent("a3d087b2cafe…");
  });

  test("is not inside the transformed canvas and tracks the active capture", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const panel = within(detail()).getByTestId("capture-panel");
    // Screen-fixed: the panel is layout chrome, never canvas content.
    expect(panel.closest(".react-flow")).toBeNull();

    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    expect(within(detail()).getByTestId("capture-panel")).toHaveTextContent("Mobile");
  });

  test("a non-ready capture keeps its named state and annotates nothing", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(
      within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!,
    );
    const stage = within(detail()).getByTestId("capture-stage");
    // Unavailable captures are non-annotatable: no canvas, no pin affordance.
    expect(stage.querySelector(".react-flow")).toBeNull();
    expect(within(detail()).queryByRole("button", { name: /pin|comment|note/i })).toBeNull();
    const panel = within(detail()).getByTestId("capture-panel");
    expect(panel).toHaveTextContent("Failed");
    expect(panel).not.toHaveTextContent("Natural size");
  });

  test("a click drops a draft whose composer opens beside it; Escape and switching close it", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const panel = () => within(detail()).getByTestId("capture-panel");
    const clickImage = () => {
      const image = document.querySelector(".capture-frame-image")!;
      fireEvent.pointerDown(image, { clientX: 400, clientY: 300, isPrimary: true });
      fireEvent.pointerUp(image, { clientX: 400, clientY: 300, isPrimary: true });
    };

    // No mode to enter first: the click itself is the intent (D074).
    clickImage();
    const composer = await within(detail()).findByRole("dialog", { name: "New pin" });
    // Screen-fixed beside the badge: outside the transformed plane and
    // outside the side panel, with the comment ready to type into.
    expect(composer.closest(".react-flow")).toBeNull();
    expect(composer.closest(".capture-canvas")).toBeNull();
    expect(panel().contains(composer)).toBe(false);
    expect(within(composer).getByLabelText("Comment")).toHaveFocus();
    // The side panel keeps its own job and never shows the draft.
    expect(within(panel()).getByText("Nothing selected.")).toBeInTheDocument();
    expect(panel().querySelector(".pin-badge")).toBeNull();

    // Escape in the composer cancels only the transient draft.
    fireEvent.keyDown(within(composer).getByLabelText("Comment"), { key: "Escape" });
    await waitFor(() =>
      expect(within(detail()).queryByRole("dialog", { name: "New pin" })).toBeNull(),
    );
    expect(document.querySelector(".react-flow__node-draftPin")).toBeNull();

    // A draft on one plane never leaks into another: drop again, switch to
    // Mobile, and the composer and canvas show nothing.
    clickImage();
    await within(detail()).findByRole("dialog", { name: "New pin" });
    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    await waitFor(() =>
      expect(within(detail()).queryByRole("dialog", { name: "New pin" })).toBeNull(),
    );
    expect(document.querySelector(".react-flow__node-draftPin")).toBeNull();
    expect(within(panel()).getByText("Nothing selected.")).toBeInTheDocument();
  });
});

describe("static screenshot stage", () => {
  test("contains no iframe and no link that could reach the captured site", async () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const stage = within(detail()).getByTestId("capture-stage");
    expect(stage.querySelector("iframe")).toBeNull();
    expect(stage.getAttribute("onclick")).toBeNull();
    // The only anchor React Flow renders is its required library
    // attribution; nothing ever links to the captured source.
    for (const anchor of Array.from(stage.querySelectorAll("a"))) {
      expect(anchor.getAttribute("href") ?? "").not.toContain("chickpea.co");
      expect(anchor.getAttribute("href") ?? "").toMatch(/xyflow|reactflow/);
    }
  });

  test("clicking the canvas issues no request and does not change location", async () => {
    const user = userEvent.setup();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    // The per-plane annotations read settles at mount; after that the canvas
    // is inert — clicks neither navigate nor write.
    await settleAnnotations();
    fetchMock.mockClear();
    const before = window.location.href;
    await user.click(within(detail()).getByTestId("capture-stage"));
    expect(window.location.href).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("scoped retry", () => {
  test("is offered for a terminal attempt and hidden for an in-flight one", async () => {
    const user = userEvent.setup();
    const mixed = project();
    mixed.pages[0]!.devices[0] = device("desktop", [attempt({ id: "d1", state: "capturing" })]);
    render(<ProjectWorkspace projects={[mixed]} onChanged={onChanged} />);
    expect(within(detail()).queryByRole("button", { name: /^Retry/ })).toBeNull();

    await user.click(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!);
    expect(
      within(detail()).getByRole("button", { name: "Retry Mobile capture" }),
    ).toBeInTheDocument();
  });

  test("posts one scoped request and re-reads the hierarchy", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ attempt: { id: "m2", attempt: 2 } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    // The default plane's annotations read settles at mount; the count this
    // test asserts is the retry write alone.
    await settleAnnotations();
    fetchMock.mockClear();
    await user.click(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!);
    await user.click(within(detail()).getByRole("button", { name: "Retry Mobile capture" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/pages/page-pricing/captures");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    // Exactly one page and one viewport: no sibling is resubmitted.
    expect(body.variant).toBe("mobile");
    expect(typeof body.idempotencyKey).toBe("string");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("a failed retry reports a bounded error and does not re-read", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Request rejected." }), { status: 409 }),
    );
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await user.click(within(tree()).getAllByRole("button", { name: /^Mobile capture of/ })[1]!);
    await user.click(within(detail()).getByRole("button", { name: "Retry Mobile capture" }));

    expect(
      within(detail())
        .getAllByRole("alert")
        .some((node) => node.textContent?.includes("could not be retried")),
    ).toBe(true);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("pin placement and persistence (VAL-PIN-001, VAL-PIN-003, VAL-CANVAS-006)", () => {
  const savedPin = {
    id: "ann-saved-1",
    captureId: "root-d1",
    kind: "pin",
    number: 1,
    tip: { x: 720, y: 4000 },
    body: "The hero headline duplicates the nav wordmark.",
    elementSnapshot: null,
    revision: 1,
    createdAt: 1_800_000_000_000,
  };

  const candidateElement = {
    id: "cell-1",
    kind: "table-cell",
    tag: "td",
    role: "cell",
    text: "Starter plan",
    accessibleName: "",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: ["body:0", "main:0", "table:0", "tr:2", "td:1"],
    rect: { x: 800, y: 4200, width: 120, height: 48 },
  };

  /** The stub store's pin shape: savedPin, with a widened snapshot slot. */
  type StubPin = Omit<typeof savedPin, "elementSnapshot"> & {
    elementSnapshot: typeof candidateElement | null;
  };

  /**
   * A stateful annotations + context endpoint: one in-memory pin list per
   * test, with revision-precondition PATCH/DELETE semantics mirroring the
   * server (stale writes conflict).
   */
  function stubAnnotations(
    initial: StubPin[] = [],
    contextItems: (typeof candidateElement)[] = [],
  ) {
    const pins: StubPin[] = [...initial];
    const writes: { method: string; url: string; body: Record<string, unknown> }[] = [];
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/context")) {
        return Promise.resolve(json({ candidates: contextItems }));
      }
      if (!target.includes("/annotations")) {
        return Promise.reject(new Error(`unexpected fetch: ${target}`));
      }
      const body =
        init?.body !== undefined
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {};
      if (init?.method === "POST") {
        writes.push({ method: "POST", url: target, body });
        const created = {
          ...savedPin,
          id: `ann-${writes.length}`,
          number: Math.max(0, ...pins.map((pin) => pin.number)) + 1,
          tip: body.tip as { x: number; y: number },
          body: body.body as string,
          elementSnapshot:
            body.elementId === null
              ? null
              : (contextItems.find((item) => item.id === body.elementId) ?? null),
        };
        pins.push(created);
        return Promise.resolve(json({ annotation: created }, 201));
      }
      const id = decodeURIComponent(target.split("/annotations/")[1] ?? "");
      const pin = pins.find((candidate) => candidate.id === id);
      if (init?.method === "PATCH" || init?.method === "DELETE") {
        if (!pin) return Promise.resolve(json({ error: "Request rejected." }, 404));
        if (body.expectedRevision !== pin.revision) {
          return Promise.resolve(json({ error: "Request rejected." }, 409));
        }
        writes.push({ method: init.method, url: target, body });
        if (init.method === "DELETE") {
          pins.splice(pins.indexOf(pin), 1);
          return Promise.resolve(json({ deleted: true }));
        }
        const updated = {
          ...pin,
          tip: (body.tip as { x: number; y: number } | undefined) ?? pin.tip,
          body: typeof body.body === "string" ? body.body : pin.body,
          revision: pin.revision + 1,
        };
        pins[pins.indexOf(pin)] = updated;
        return Promise.resolve(json({ annotation: updated }));
      }
      return Promise.resolve(json({ annotations: pins }));
    });
    return { pins, writes };
  }

  /** Drop one draft pin with a click at a fixed pane point; the composer opens. */
  async function placeDraft() {
    const image = document.querySelector(".capture-frame-image")!;
    fireEvent.pointerDown(image, { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.pointerUp(image, { clientX: 400, clientY: 300, isPrimary: true });
    await within(detail()).findByRole("dialog", { name: "New pin" });
  }

  const composer = () => within(detail()).getByRole("dialog", { name: "New pin" });
  const noComposer = () =>
    waitFor(() => expect(within(detail()).queryByRole("dialog", { name: "New pin" })).toBeNull());

  /** Wait for the nearby-candidate read to settle (ready or failed). */
  async function settleCandidates() {
    await waitFor(() =>
      expect(
        within(composer()).getByTestId("draft-context").getAttribute("data-candidates-state"),
      ).toMatch(/^(ready|failed)$/),
    );
  }

  /** The one-click No element override in the composer. */
  async function chooseNoElement(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(composer()).getByRole("button", { name: "No element" }));
  }

  test("with no nearby element, No element is pre-selected and one create posts the null decision", async () => {
    const user = userEvent.setup();
    const { pins, writes } = stubAnnotations();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();

    await placeDraft();
    const comment = within(composer()).getByLabelText("Comment");
    await user.type(comment, "Hero copy is placeholder text.");
    // The plane offers no nearby element, so the settled default is the
    // explicit No element; nothing else stands between typing and Save.
    await settleCandidates();
    expect(within(composer()).getByTestId("draft-choice")).toHaveTextContent("No element");
    expect(within(composer()).getByTestId("draft-choice")).not.toHaveAttribute(
      "data-element-id",
    );
    expect(within(composer()).getByRole("button", { name: "Save pin" })).toBeEnabled();
    await user.click(within(composer()).getByRole("button", { name: "Save pin" }));

    // Exactly one create, addressed to the selected capture, carrying the
    // tip, the comment, the explicit null decision, and the draft's key.
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.url).toBe("/api/captures/root-d1/annotations");
    expect(typeof writes[0]!.body.idempotencyKey).toBe("string");
    expect(writes[0]!.body.body).toBe("Hero copy is placeholder text.");
    expect(writes[0]!.body.elementId).toBeNull();
    const tip = writes[0]!.body.tip as { x: number; y: number };
    expect(Number.isFinite(tip.x)).toBe(true);

    // The draft resolved and the saved pin renders in the list and canvas.
    await noComposer();
    const list = within(detail()).getByRole("list", { name: "Saved pins" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(within(list).getByRole("button", { name: /Pin 1/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelectorAll(".react-flow__node-pin")).toHaveLength(1),
    );
    expect(pins).toHaveLength(1);
  });

  test("the top-ranked candidate is pre-selected, submitted by id, and its snapshot comes back", async () => {
    const user = userEvent.setup();
    const { writes } = stubAnnotations([], [candidateElement]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();

    // The ranked read resolves and the first candidate is already the chip:
    // no radio to find, nothing to click before Save.
    await settleCandidates();
    const chip = within(composer()).getByTestId("draft-choice");
    expect(chip).toHaveAttribute("data-element-id", "cell-1");
    expect(chip).toHaveTextContent(/Starter plan/);
    expect(within(composer()).queryByRole("radio")).toBeNull();
    await user.type(within(composer()).getByLabelText("Comment"), "This cell, specifically.");
    await user.click(within(composer()).getByRole("button", { name: "Save pin" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    // Only the capture-local id crosses the wire — never a metadata object.
    expect(writes[0]!.body.elementId).toBe("cell-1");
    expect(writes[0]!.body.elementSnapshot).toBeUndefined();
    await noComposer();
    await user.click(within(sidePanel()).getByRole("button", { name: /Pin 1/ }));
    expect(within(detail()).getByTestId("panel-snapshot")).toHaveTextContent(/Starter plan/);
  });

  test("No element overrides the pre-selected candidate with one click", async () => {
    const user = userEvent.setup();
    const { writes } = stubAnnotations([], [candidateElement]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();
    await settleCandidates();
    expect(within(composer()).getByTestId("draft-choice")).toHaveAttribute(
      "data-element-id",
      "cell-1",
    );
    await chooseNoElement(user);
    expect(within(composer()).getByTestId("draft-choice")).toHaveTextContent("No element");
    await user.type(within(composer()).getByLabelText("Comment"), "Background, not the cell.");
    await user.click(within(composer()).getByRole("button", { name: "Save pin" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.body.elementId).toBeNull();
  });

  test("Save waits for a non-blank comment and the settled default, nothing more", async () => {
    const user = userEvent.setup();
    stubAnnotations();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();

    const save = within(composer()).getByRole("button", { name: "Save pin" });
    expect(save).toBeDisabled();
    await settleCandidates();
    // The default is settled; the comment is still blank.
    expect(save).toBeDisabled();
    await user.type(within(composer()).getByLabelText("Comment"), "   ");
    expect(save).toBeDisabled();
    await user.type(within(composer()).getByLabelText("Comment"), "real feedback");
    expect(save).toBeEnabled();
  });

  test("Enter saves the draft; Shift+Enter only starts a new line", async () => {
    const user = userEvent.setup();
    const { writes } = stubAnnotations();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();
    await settleCandidates();

    const comment = within(composer()).getByLabelText("Comment");
    expect(comment).toHaveFocus();
    await user.type(comment, "line one{Shift>}{Enter}{/Shift}line two");
    expect(comment).toHaveValue("line one\nline two");
    expect(writes).toHaveLength(0);

    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.body.body).toBe("line one\nline two");
    expect(writes[0]!.body.elementId).toBeNull();
    await noComposer();
  });

  test("Escape in the composer cancels the draft without any write", async () => {
    const user = userEvent.setup();
    const { writes } = stubAnnotations();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();
    await user.type(within(composer()).getByLabelText("Comment"), "never saved");
    await user.keyboard("{Escape}");
    await noComposer();
    expect(document.querySelector(".react-flow__node-draftPin")).toBeNull();
    expect(writes).toHaveLength(0);
  });

  test("N drops a draft at the viewport center from the canvas region", async () => {
    stubAnnotations();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    const region = within(detail()).getByRole("region", { name: /^Screenshot of/ });
    fireEvent.keyDown(region, { key: "n" });
    await within(detail()).findByRole("dialog", { name: "New pin" });
    expect(document.querySelectorAll(".react-flow__node-draftPin")).toHaveLength(1);
    // The nearby-candidate read runs for it exactly as for a click.
    await settleCandidates();
    expect(
      fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/context")),
    ).toHaveLength(1);
  });

  test("hovering a candidate highlights its manifest rect on the canvas; choice, cancel, and plane switch clear it (VAL-PIN-004)", async () => {
    const user = userEvent.setup();
    const { writes } = stubAnnotations([], [candidateElement]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();

    // The candidate list settles behind the chip; Change opens it, then
    // hover previews exactly the candidate's persisted rectangle — a pure
    // local render with zero writes.
    await settleCandidates();
    await user.click(within(composer()).getByRole("button", { name: "Change" }));
    const row = document.querySelector('.panel-candidate[data-element-id="cell-1"]')!;
    const preview = () => document.querySelector(".react-flow__node-contextPreview");
    expect(preview()).toBeNull();

    fireEvent.mouseEnter(row);
    await waitFor(() => expect(preview()).not.toBeNull());
    expect((preview() as HTMLElement).style.transform).toContain("translate(800px,4200px)");
    expect(writes).toHaveLength(0);

    // Replacement: leaving clears, and making a choice ends the preview. The
    // one candidate is already the pre-selected choice (clicking its radio
    // again changes nothing), so the choice that changes is No element.
    fireEvent.mouseLeave(row);
    await waitFor(() => expect(preview()).toBeNull());
    fireEvent.mouseEnter(row);
    await waitFor(() => expect(preview()).not.toBeNull());
    await user.click(within(composer()).getByRole("button", { name: "No element" }));
    await waitFor(() => expect(preview()).toBeNull());
    expect(within(composer()).getByRole("radio", { name: "No element" })).toBeChecked();
    expect(writes).toHaveLength(0);

    // Cancel resolves the draft; the highlight dies with it (the composer
    // closes first, the canvas reports the cleared draft, and the
    // workspace's draft lifecycle drops the highlight — a few renders, no
    // hover-leave needed).
    fireEvent.mouseEnter(row);
    await waitFor(() => expect(preview()).not.toBeNull());
    await user.click(within(composer()).getByRole("button", { name: "Cancel" }));
    await noComposer();
    await waitFor(() => expect(preview()).toBeNull());
    expect(writes).toHaveLength(0);

    // A highlight on one plane never crosses a plane switch.
    await placeDraft();
    await settleCandidates();
    await user.click(within(composer()).getByRole("button", { name: "Change" }));
    fireEvent.mouseEnter(document.querySelector('.panel-candidate[data-element-id="cell-1"]')!);
    await waitFor(() => expect(preview()).not.toBeNull());
    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    await waitFor(() => expect(preview()).toBeNull());
    expect(writes).toHaveLength(0);
  });

  test("Cancel discards the draft without any write", async () => {
    const user = userEvent.setup();
    const { writes } = stubAnnotations();
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();
    await user.type(within(composer()).getByLabelText("Comment"), "never saved");
    await settleCandidates();

    await user.click(within(composer()).getByRole("button", { name: "Cancel" }));
    await noComposer();
    expect(document.querySelector(".react-flow__node-draftPin")).toBeNull();
    expect(writes).toHaveLength(0);
    expect(within(detail()).getByText("Nothing selected.")).toBeInTheDocument();
  });

  test("a failed save keeps the draft, comment, and decision and reports the failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/context")) return Promise.resolve(json({ candidates: [] }));
      if (init?.method === "POST") {
        return Promise.resolve(json({ error: "Service unavailable." }, 503));
      }
      return Promise.resolve(json({ annotations: [] }));
    });
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await settleAnnotations();
    await placeDraft();
    await user.type(within(composer()).getByLabelText("Comment"), "keep me");
    await settleCandidates();

    await user.click(within(composer()).getByRole("button", { name: "Save pin" }));
    await waitFor(() =>
      expect(within(composer()).getByRole("alert")).toHaveTextContent(/could not be saved/i),
    );
    // Recoverable: the draft, the comment, the decision, and the draft node
    // all survive — a retry replays the same intent.
    expect(within(composer()).getByLabelText("Comment")).toHaveValue("keep me");
    expect(within(composer()).getByTestId("draft-choice")).toHaveTextContent("No element");
    expect(document.querySelector(".react-flow__node-draftPin")).not.toBeNull();
    expect(within(detail()).queryByRole("list", { name: "Saved pins" })).toBeNull();
  });

  test("the pins list opens a saved pin's comment and the badge marks the selection", async () => {
    const user = userEvent.setup();
    stubAnnotations([savedPin]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await waitFor(() =>
      expect(
        within(sidePanel()).getByRole("button", { name: /Pin 1 — at \(720, 4000\)/ }),
      ).toBeInTheDocument(),
    );

    await user.click(within(sidePanel()).getByRole("button", { name: /Pin 1/ }));
    const panel = within(detail()).getByTestId("panel-pin");
    expect(panel).toHaveTextContent("Pin 1");
    expect(panel).toHaveTextContent("The hero headline duplicates the nav wordmark.");
    expect(within(panel).getByTestId("panel-snapshot")).toHaveTextContent("Element: No element");
    expect(document.querySelector('[data-selected="true"]')).not.toBeNull();

    // Selecting again clears back to the empty state.
    await user.click(within(sidePanel()).getByRole("button", { name: /Pin 1/ }));
    expect(within(detail()).queryByTestId("panel-pin")).toBeNull();
    expect(within(detail()).getByText("Nothing selected.")).toBeInTheDocument();
  });

  test("pins are scoped to their plane: another capture lists only its own", async () => {
    const user = userEvent.setup();
    stubAnnotations([savedPin]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await waitFor(() =>
      expect(within(sidePanel()).getByRole("button", { name: /Pin 1/ })).toBeInTheDocument(),
    );
    expect(document.querySelectorAll(".react-flow__node-pin")).toHaveLength(1);

    // The mock serves the same list for any capture id; the workspace must
    // re-fetch on switch and never show the old plane's pins mid-flight.
    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    await waitFor(() =>
      expect(within(sidePanel()).getByRole("button", { name: /Pin 1/ })).toBeInTheDocument(),
    );
    const requested = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/annotations"));
    expect(requested).toContain("/api/captures/root-d1/annotations");
    expect(requested).toContain("/api/captures/root-m1/annotations");
  });

  test("a stale pins response from a previous plane never overwrites the current one", async () => {
    const user = userEvent.setup();
    // Hold every annotations load open so resolution order is the test's to
    // control; the desktop plane's answer is released after the switch.
    const pending = new Map<string, (value: Response) => void>();
    fetchMock.mockImplementation((url: unknown) => {
      const target = String(url);
      if (target.includes("/context")) return Promise.resolve(json({ candidates: [] }));
      if (target.includes("/annotations")) {
        return new Promise<Response>((resolve) => pending.set(target, resolve));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await waitFor(() => expect(pending.has("/api/captures/root-d1/annotations")).toBe(true));

    await user.click(
      within(tree()).getByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    );
    await waitFor(() => expect(pending.has("/api/captures/root-m1/annotations")).toBe(true));

    // The previous plane's answer lands late, carrying a pin: the current
    // plane must stay untouched by it.
    await act(async () => {
      pending.get("/api/captures/root-d1/annotations")!(json({ annotations: [savedPin] }));
    });
    expect(within(sidePanel()).queryByRole("button", { name: /Pin 1/ })).toBeNull();

    await act(async () => {
      pending.get("/api/captures/root-m1/annotations")!(json({ annotations: [] }));
    });
    await waitFor(() =>
      expect(within(sidePanel()).getByText(/No pins yet/)).toBeInTheDocument(),
    );
    expect(within(sidePanel()).queryByRole("button", { name: /Pin 1/ })).toBeNull();
  });

  test("editing a saved comment sends one revisioned PATCH and shows the result", async () => {
    const user = userEvent.setup();
    const { pins, writes } = stubAnnotations([savedPin]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await waitFor(() =>
      expect(within(sidePanel()).getByRole("button", { name: /Pin 1/ })).toBeInTheDocument(),
    );
    await user.click(within(sidePanel()).getByRole("button", { name: /Pin 1/ }));

    await user.click(within(detail()).getByRole("button", { name: "Edit comment" }));
    const editor = within(detail()).getByLabelText("Edit comment");
    await user.clear(editor);
    await user.type(editor, "A sharper note about the hero.");
    await user.click(within(detail()).getByRole("button", { name: "Save edit" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.method).toBe("PATCH");
    expect(writes[0]!.body.body).toBe("A sharper note about the hero.");
    expect(writes[0]!.body.expectedRevision).toBe(1);
    await waitFor(() =>
      expect(within(detail()).getByTestId("panel-pin")).toHaveTextContent(
        "A sharper note about the hero.",
      ),
    );
    expect(pins[0]!.revision).toBe(2);
  });

  test("a stale edit conflicts, closes the editor, and reloads the authoritative pin", async () => {
    const user = userEvent.setup();
    // Another session already wrote: the served record is at revision 2
    // while the panel's copy still believes revision 1.
    const stalePin = { ...savedPin, revision: 1 };
    const { pins } = stubAnnotations([stalePin]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await waitFor(() =>
      expect(within(sidePanel()).getByRole("button", { name: /Pin 1/ })).toBeInTheDocument(),
    );
    // The server-side truth moves first (another session's write).
    pins[0] = { ...pins[0]!, body: "Another session rewrote this.", revision: 2 };
    await user.click(within(sidePanel()).getByRole("button", { name: /Pin 1/ }));
    await user.click(within(detail()).getByRole("button", { name: "Edit comment" }));
    await user.type(within(detail()).getByLabelText("Edit comment"), " stale text");
    await user.click(within(detail()).getByRole("button", { name: "Save edit" }));

    await waitFor(() =>
      expect(within(detail()).getByRole("alert")).toHaveTextContent(
        /changed in another session/i,
      ),
    );
    // The authoritative version replaced the losing edit.
    await waitFor(() =>
      expect(within(detail()).getByTestId("panel-pin")).toHaveTextContent(
        "Another session rewrote this.",
      ),
    );
    expect(within(detail()).queryByLabelText("Edit comment")).toBeNull();
  });

  test("deleting a saved pin is a two-step revisioned DELETE and the pin leaves the list", async () => {
    const user = userEvent.setup();
    const { pins, writes } = stubAnnotations([savedPin]);
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    await waitFor(() =>
      expect(within(sidePanel()).getByRole("button", { name: /Pin 1/ })).toBeInTheDocument(),
    );
    await user.click(within(sidePanel()).getByRole("button", { name: /Pin 1/ }));

    // Step one arms the confirm; Keep pin backs out without a write.
    await user.click(within(detail()).getByRole("button", { name: "Delete pin" }));
    await user.click(within(detail()).getByRole("button", { name: "Keep pin" }));
    expect(writes).toHaveLength(0);
    await user.click(within(detail()).getByRole("button", { name: "Delete pin" }));
    await user.click(within(detail()).getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.method).toBe("DELETE");
    expect(writes[0]!.body.expectedRevision).toBe(1);
    await waitFor(() =>
      expect(
        within(sidePanel()).queryByRole("button", { name: /Pin 1 — at/ }),
      ).toBeNull(),
    );
    expect(pins).toHaveLength(0);
    await waitFor(() =>
      expect(document.querySelectorAll(".react-flow__node-pin")).toHaveLength(0),
    );
    expect(within(detail()).getByText("Nothing selected.")).toBeInTheDocument();
  });
});
