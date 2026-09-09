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

const onChanged = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

function attempt(overrides: Partial<AttemptView> = {}): AttemptView {
  return {
    id: "cap-1",
    variant: "desktop",
    attempt: 1,
    state: "pending",
    errorCode: null,
    imageHash: null,
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
    expect(within(detail()).getByRole("heading")).toHaveTextContent(
      "Mobile — https://chickpea.co/pricing",
    );
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
    expect(within(detail()).getByTestId("capture-stage")).toHaveTextContent(
      "Static capture v1 is ready",
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
    // The older version stays addressable.
    await user.click(buttons[1]!);
    expect(within(detail()).getByTestId("capture-stage")).toHaveTextContent(
      "Static capture v1 is ready",
    );
  });
});

describe("static screenshot stage", () => {
  test("contains no link, iframe, or navigable element", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const stage = within(detail()).getByTestId("capture-stage");
    expect(stage.querySelector("a")).toBeNull();
    expect(stage.querySelector("iframe")).toBeNull();
    expect(stage.querySelector("button")).toBeNull();
    expect(stage.getAttribute("onclick")).toBeNull();
  });

  test("clicking the stage issues no request and does not change location", async () => {
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
