// @vitest-environment jsdom
// The project/page/device navigation surface (VAL-PROJECT-003,
// VAL-PROJECT-005): pages listed only under their owning project in submitted
// order, Desktop and Mobile per page, exactly one active item, partial
// statuses that keep successful siblings usable, retry offered only for a
// terminal or stale attempt, deterministic newest-first version selection,
// and a screenshot stage that cannot navigate.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

beforeEach(() => {
  onChanged.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tree = () => screen.getByRole("navigation", { name: "Projects, pages, and devices" });
const detail = () => screen.getByRole("region", { name: "Selected capture" });

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

  test("the hint explains pan/zoom and states plainly that pinning is not here yet", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    // Plain language, no jargon: user-testing round 2 (2026-09-10) found the
    // old "canvas update" wording sent the user hunting for a pin gesture
    // that does not exist in this build.
    const hint = within(detail()).getByText(/drag to pan/i);
    expect(hint).toHaveTextContent(/scroll or pinch to zoom/i);
    expect(hint).toHaveTextContent(/static screenshot/i);
    expect(hint).toHaveTextContent(
      /pinning and commenting are not available in this build yet/i,
    );
    expect(hint.textContent?.toLowerCase()).not.toContain("canvas update");
    // No dead affordance: nothing that looks like a pin/comment/note control.
    expect(
      within(detail()).queryByRole("button", { name: /pin|comment|note/i }),
    ).toBeNull();
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
