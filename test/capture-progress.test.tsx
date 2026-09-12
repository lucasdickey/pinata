// @vitest-environment jsdom
// The project-level capture progress line and retry control (D076): the line
// reads the server-computed progress block, names the page capturing now and
// a plain-words time left, lists every failed device with its catalog reason
// once nothing is moving, retries all of them through the scoped retry route
// with one key per device, and never appears for a payload without progress.
// Pinning stays available on a ready capture while its siblings capture.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CaptureProgress,
  describeRemaining,
  progressLine,
  shortPageName,
  type ProgressProject,
  type ProjectProgress,
} from "../src/components/capture-progress";
import {
  ProjectWorkspace,
  type AttemptView,
  type DeviceView,
  type WorkspaceProject,
} from "../src/components/project-workspace";
import { installReactFlowMocks } from "./helpers/react-flow";

installReactFlowMocks();

let fetchMock: ReturnType<typeof vi.fn>;
const onChanged = vi.fn();

function progress(overrides: Partial<ProjectProgress> = {}): ProjectProgress {
  return {
    total: 8,
    done: 2,
    failed: 0,
    inProgress: 6,
    capturingPage: "https://chickpea.co/pricing",
    estimatedRemainingMs: 110_000,
    ...overrides,
  };
}

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
          device("mobile", [attempt({ id: "root-m1", variant: "mobile", state: "capturing" })]),
        ],
      },
      {
        id: "page-pricing",
        normalizedUrl: "https://chickpea.co/pricing",
        sortIndex: 1,
        devices: [
          device("desktop", [attempt({ id: "pricing-d1" })]),
          device("mobile", [attempt({ id: "pricing-m1", variant: "mobile" })]),
        ],
      },
    ],
    counts: { pages: 2, attempts: 4, ready: 1, failed: 0, inProgress: 3 },
    progress: progress({ total: 4, done: 1, failed: 0, inProgress: 3, capturingPage: "https://chickpea.co/" }),
    ...overrides,
  };
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
    if (target.includes("/context")) return Promise.resolve(json({ candidates: [] }));
    if (target.includes("/annotations")) return Promise.resolve(json({ annotations: [] }));
    return Promise.reject(new Error(`unexpected fetch: ${target}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "pinata_csrf=proof-token",
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("progressLine", () => {
  test("names the current capture, the page, and the time left", () => {
    expect(progressLine(progress())).toBe(
      "Capturing 3 of 8 · chickpea.co/pricing · about 2 minutes left",
    );
  });

  test("leaves out what the server does not know yet", () => {
    expect(progressLine(progress({ capturingPage: null, estimatedRemainingMs: null }))).toBe(
      "Capturing 3 of 8",
    );
    expect(progressLine(progress({ capturingPage: null, estimatedRemainingMs: 30_000 }))).toBe(
      "Capturing 3 of 8 · less than a minute left",
    );
  });

  test("summarizes a finished project, with or without failures", () => {
    expect(progressLine(progress({ done: 8, inProgress: 0, capturingPage: null }))).toBe(
      "All 8 captures ready",
    );
    expect(
      progressLine(progress({ done: 6, failed: 2, inProgress: 0, capturingPage: null })),
    ).toBe("6 of 8 captured · 2 captures failed");
    expect(
      progressLine(progress({ done: 7, failed: 1, inProgress: 0, capturingPage: null })),
    ).toBe("7 of 8 captured · 1 capture failed");
    expect(progressLine(progress({ total: 0, done: 0, inProgress: 0 }))).toBeNull();
  });

  test("helpers read plainly", () => {
    expect(shortPageName("https://chickpea.co/")).toBe("chickpea.co");
    expect(shortPageName("https://chickpea.co/pricing/")).toBe("chickpea.co/pricing");
    expect(shortPageName("not a url")).toBe("not a url");
    expect(describeRemaining(59_999)).toBe("less than a minute left");
    expect(describeRemaining(60_000)).toBe("about 1 minute left");
    expect(describeRemaining(61_000)).toBe("about 2 minutes left");
  });
});

describe("CaptureProgress", () => {
  const base: ProgressProject = {
    projectId: "p1",
    progress: progress(),
    pages: [],
  };

  test("renders the line as a status and nothing else while work is moving", () => {
    render(<CaptureProgress project={base} onChanged={onChanged} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Capturing 3 of 8 · chickpea.co/pricing · about 2 minutes left",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("renders nothing for a payload without a progress block", () => {
    const { container } = render(
      <CaptureProgress project={{ projectId: "p1", pages: [] }} onChanged={onChanged} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("lists failed devices with catalog reasons and retries them all, one key each", async () => {
    const user = userEvent.setup();
    const failedProject: ProgressProject = {
      projectId: "p1",
      progress: progress({ done: 2, failed: 2, inProgress: 0, capturingPage: null, total: 4 }),
      pages: [
        {
          id: "page-root",
          normalizedUrl: "https://chickpea.co/",
          devices: [
            { variant: "desktop", retryable: true, latest: { state: "ready", errorCode: null } },
            {
              variant: "mobile",
              retryable: true,
              latest: { state: "failed", errorCode: "total-timeout" },
            },
          ],
        },
        {
          id: "page-pricing",
          normalizedUrl: "https://chickpea.co/pricing",
          devices: [
            {
              variant: "desktop",
              retryable: true,
              latest: { state: "failed", errorCode: "dns-failed" },
            },
            { variant: "mobile", retryable: true, latest: { state: "ready", errorCode: null } },
          ],
        },
      ],
    };
    const bodies: { url: string; body: { variant: string; idempotencyKey: string } }[] = [];
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      bodies.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Promise.resolve(json({ attempt: { id: "new" } }, 201));
    });

    render(<CaptureProgress project={failedProject} onChanged={onChanged} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 of 4 captured · 2 captures failed");
    const list = screen.getByRole("list", { name: "Failed captures" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Mobile — chickpea.co: The capture exceeded its total time budget.",
      "Desktop — chickpea.co/pricing: The address could not be resolved to a public host.",
    ]);

    await user.click(screen.getByRole("button", { name: "Retry 2 failed captures" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.url).toBe("/api/pages/page-root/captures");
    expect(bodies[0]!.body.variant).toBe("mobile");
    expect(bodies[1]!.url).toBe("/api/pages/page-pricing/captures");
    expect(bodies[1]!.body.variant).toBe("desktop");
    expect(bodies[0]!.body.idempotencyKey).not.toBe(bodies[1]!.body.idempotencyKey);
    expect(fetchMock.mock.calls[0]![1].headers["x-pinata-csrf"]).toBe("proof-token");
  });

  test("a refused retry reports plainly and keeps the control", async () => {
    const user = userEvent.setup();
    const failedProject: ProgressProject = {
      projectId: "p1",
      progress: progress({ done: 1, failed: 1, inProgress: 0, capturingPage: null, total: 2 }),
      pages: [
        {
          id: "page-root",
          normalizedUrl: "https://chickpea.co/",
          devices: [
            {
              variant: "desktop",
              retryable: true,
              latest: { state: "failed", errorCode: "browserless-provider" },
            },
          ],
        },
      ],
    };
    fetchMock.mockImplementation(() => Promise.resolve(json({ error: "Request rejected." }, 429)));
    render(<CaptureProgress project={failedProject} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Retry the failed capture" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be retried/i);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry the failed capture" })).toBeEnabled();
  });

  test("failures are not listed while other captures are still moving", () => {
    const mixed: ProgressProject = {
      projectId: "p1",
      progress: progress({ done: 1, failed: 1, inProgress: 2, capturingPage: null, total: 4 }),
      pages: [
        {
          id: "page-root",
          normalizedUrl: "https://chickpea.co/",
          devices: [
            { variant: "desktop", retryable: true, latest: { state: "failed", errorCode: "dns-failed" } },
          ],
        },
      ],
    };
    render(<CaptureProgress project={mixed} onChanged={onChanged} />);
    expect(screen.getByRole("status")).toHaveTextContent("Capturing 3 of 4");
    expect(screen.queryByRole("list", { name: "Failed captures" })).not.toBeInTheDocument();
  });
});

describe("in the workspace", () => {
  const detail = () => screen.getByRole("region", { name: "Selected capture" });

  test("the line sits at the top of the selected project's detail area", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    const line = within(detail()).getByTestId("capture-progress");
    expect(line).toHaveTextContent("Capturing 2 of 4 · chickpea.co · about 2 minutes left");
    expect(within(line).getByRole("status")).toBeInTheDocument();
    // Before the hint and the canvas: the first thing after the heading.
    const heading = within(detail()).getByRole("heading", { level: 3 });
    expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const hint = within(detail()).getByText(/drag to pan/i);
    expect(line.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("pinning is available on the ready capture while its siblings still capture", () => {
    render(<ProjectWorkspace projects={[project()]} onChanged={onChanged} />);
    // The default selection is the first page's Desktop device, which is
    // ready; its siblings are capturing or queued.
    const placePin = within(detail()).getByRole("button", { name: "Place pin" });
    expect(placePin).toBeEnabled();
    expect(placePin).toHaveAttribute("aria-pressed", "false");
    expect(within(detail()).getByTestId("capture-progress")).toHaveTextContent(
      /Capturing 2 of 4/,
    );
    expect(within(detail()).queryByText(/No capture to show yet/)).not.toBeInTheDocument();
  });

  test("a project without a progress block shows no line", () => {
    const { progress: _omitted, ...withoutProgress } = project();
    void _omitted;
    render(<ProjectWorkspace projects={[withoutProgress]} onChanged={onChanged} />);
    expect(within(detail()).queryByTestId("capture-progress")).not.toBeInTheDocument();
  });
});
