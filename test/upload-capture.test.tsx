// @vitest-environment jsdom
// Uploading a capture from the editor's page (D131): reading the Chrome
// extension's capture file, the overview card and its page choice, the
// canvas view's "Upload a new version", the New project start, and the
// one-device-per-request sends — Desktop first, then the rest onto the page
// the first one landed on, each with the CSRF proof.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkspaceProject } from "../src/components/project-workspace";
import { UploadCaptureCard, UploadPanel } from "../src/components/upload-capture";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../src/lib/auth-constants";
import {
  CAPTURE_PACKAGE_FORMAT,
  CAPTURE_PACKAGE_VERSION,
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
} from "../src/lib/boundaries";
import {
  base64ToBytes,
  guessVariant,
  importErrorMessage,
  parseCapturePackage,
  targetWidth,
} from "../src/lib/capture-upload";

const PNG_BASE64 = btoa("\x89PNG-not-really-but-bytes");

function capturePackage(overrides: Record<string, unknown> = {}) {
  return {
    format: CAPTURE_PACKAGE_FORMAT,
    version: CAPTURE_PACKAGE_VERSION,
    source: { url: "https://app.example.com/settings#billing", title: "Settings" },
    capturedAt: "2026-10-10T12:00:00.000Z",
    tool: { name: "Pinata Chrome extension", version: "0.1.0" },
    variants: [
      {
        variant: "mobile",
        viewport: { width: 390, height: 844 },
        document: { width: 390, height: 2100 },
        manifest: { schemaVersion: 1, truncated: false, elements: [{ id: "e1" }] },
        image: { contentType: "image/webp", base64: PNG_BASE64 },
      },
      {
        variant: "desktop",
        viewport: { width: 1440, height: 900 },
        document: { width: 1440, height: 1600 },
        manifest: { schemaVersion: 1, truncated: false, elements: [{ id: "e1" }, { id: "e2" }] },
        image: { contentType: "image/webp", base64: PNG_BASE64 },
      },
    ],
    ...overrides,
  };
}

function project(): WorkspaceProject {
  return {
    projectId: "proj-1",
    publicId: "pub-1",
    title: "Example app",
    rootUrl: "https://app.example.com/",
    pages: [
      {
        id: "page-home",
        normalizedUrl: "https://app.example.com/",
        sortIndex: 0,
        devices: [],
      },
      {
        id: "page-settings",
        normalizedUrl: "https://app.example.com/settings",
        sortIndex: 1,
        devices: [],
      },
    ],
    counts: { pages: 2, attempts: 4, ready: 4, failed: 0, inProgress: 0 },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let replies: { status: number; body: unknown }[];

const sent = () =>
  fetchMock.mock.calls.map(([url, init]) => {
    const form = (init as RequestInit).body as FormData;
    return {
      url: String(url),
      csrf: new Headers((init as RequestInit).headers).get(EDITOR_CSRF_HEADER),
      meta: JSON.parse(String(form.get("meta"))) as Record<string, any>,
      image: form.get("image") as File,
    };
  });

function fileOf(content: unknown, name = "capture.pinata.json"): File {
  return new File([JSON.stringify(content)], name, { type: "application/json" });
}

beforeEach(() => {
  replies = [];
  fetchMock = vi.fn(() => {
    const next = replies.shift() ?? { status: 500, body: { error: "unexpected" } };
    return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
  });
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = `${EDITOR_CSRF_COOKIE}=editor-proof-sentinel`;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${EDITOR_CSRF_COOKIE}=; Max-Age=0`;
});

const imported = (variant: string, attempt = 1, created = false) => ({
  status: 201,
  body: {
    project: { publicId: "pub-1", title: "Example app", created: false },
    page: { id: "page-settings", normalizedUrl: "https://app.example.com/settings", created },
    capture: { id: `cap-${variant}`, variant, attempt, elements: 2 },
  },
});

describe("capture files and images", () => {
  test("a capture file reads Desktop first, one entry per device", () => {
    const parsed = parseCapturePackage(JSON.stringify(capturePackage()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.variants.map((entry) => entry.variant)).toEqual(["desktop", "mobile"]);
    expect(parsed.value.source.url).toBe("https://app.example.com/settings#billing");
  });

  test("anything else is refused with a reason", () => {
    expect(parseCapturePackage("not json")).toEqual({ ok: false, reason: "not-json" });
    expect(parseCapturePackage(JSON.stringify({ format: "other" }))).toEqual({
      ok: false,
      reason: "not-a-capture",
    });
    expect(parseCapturePackage(JSON.stringify(capturePackage({ version: 99 })))).toEqual({
      ok: false,
      reason: "version",
    });
    expect(parseCapturePackage(JSON.stringify(capturePackage({ variants: [] })))).toEqual({
      ok: false,
      reason: "empty",
    });
    const broken = capturePackage();
    (broken.variants[0] as Record<string, unknown>).document = { width: -1, height: 2 };
    expect(parseCapturePackage(JSON.stringify(broken))).toEqual({ ok: false, reason: "not-a-capture" });
  });

  test("high-DPR images come down to the device's width; others keep their pixels", () => {
    expect(targetWidth(2880, "desktop")).toBe(1440);
    expect(targetWidth(1920, "desktop")).toBe(1920);
    expect(targetWidth(1170, "mobile")).toBe(390);
    expect(targetWidth(390, "mobile")).toBe(390);
    expect(guessVariant(1170)).toBe("desktop");
    expect(guessVariant(390)).toBe("mobile");
    expect(base64ToBytes("AAEC")).toEqual(new Uint8Array([0, 1, 2]));
    expect(base64ToBytes("***")).toBeNull();
  });

  test("refusals become plain sentences", () => {
    expect(importErrorMessage({ status: 422, code: "too-many-captures" })).toMatch(/used up/);
    expect(importErrorMessage({ status: 0, code: null })).toMatch(/could not reach/);
    expect(importErrorMessage({ status: 404, code: null })).toMatch(/no longer there/);
  });
});

describe("Upload a capture (overview card)", () => {
  test("a capture file goes up Desktop then Mobile, the second onto the first one's page", async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    render(
      <ul>
        <UploadCaptureCard project={project()} onUploaded={onUploaded} />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Upload a capture" }));
    await user.upload(screen.getByTestId("upload-file"), fileOf(capturePackage()));

    expect(await screen.findByTestId("upload-review")).toHaveTextContent(
      "Capture of https://app.example.com/settings#billing",
    );
    expect(screen.getByTestId("upload-review")).toHaveTextContent(
      "Desktop (1440 × 1600, 2 elements) and Mobile (390 × 2100, 1 element)",
    );
    // The file's address is already a page here, so that page is chosen.
    expect(screen.getByRole("combobox", { name: "Page" })).toHaveValue("page-settings");

    replies = [imported("desktop", 2), imported("mobile", 2)];
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));

    const calls = sent();
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url === "/api/imports")).toBe(true);
    expect(calls.every((call) => call.csrf === "editor-proof-sentinel")).toBe(true);
    expect(calls[0]!.meta).toMatchObject({
      target: { project: "pub-1", page: "page-settings" },
      url: "https://app.example.com/settings#billing",
      variant: "desktop",
      capturedAt: Date.parse("2026-10-10T12:00:00.000Z"),
      document: { width: 1440, height: 1600 },
    });
    expect(calls[0]!.image.type).toBe("image/webp");
    expect(calls[1]!.meta).toMatchObject({
      target: { project: "pub-1", page: "page-settings" },
      variant: "mobile",
    });
    expect(calls[0]!.meta.idempotencyKey).not.toBe(calls[1]!.meta.idempotencyKey);
    expect(screen.getByTestId("upload-capture-status")).toHaveTextContent(
      "Uploaded 2 screenshots of https://app.example.com/settings.",
    );
  });

  test("a capture of an address the project doesn't have offers a new page", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <UploadCaptureCard project={project()} onUploaded={vi.fn()} />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Upload a capture" }));
    await user.upload(
      screen.getByTestId("upload-file"),
      fileOf(capturePackage({ source: { url: "https://app.example.com/billing" } })),
    );
    const select = await screen.findByRole("combobox", { name: "Page" });
    expect(select).toHaveValue("new");
    expect(screen.getByRole("option", { name: "New page — https://app.example.com/billing" })).toBeInTheDocument();

    replies = [imported("desktop", 1, true), imported("mobile", 1)];
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent()[0]!.meta.target).toEqual({ project: "pub-1" });
    expect(sent()[1]!.meta.target).toEqual({ project: "pub-1", page: "page-settings" });
  });

  test("a file that isn't a capture says so and uploads nothing", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(
      <ul>
        <UploadCaptureCard project={project()} onUploaded={vi.fn()} />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Upload a capture" }));
    await user.upload(screen.getByTestId("upload-file"), fileOf({ hello: "world" }, "notes.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That file isn't a Pinata capture file or an image.",
    );
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    await user.upload(
      screen.getByTestId("upload-file"),
      new File(["%PDF"], "doc.pdf", { type: "application/pdf" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("PNG, JPEG, or WebP");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a refusal partway keeps the panel open and says what went up", async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    render(
      <ul>
        <UploadCaptureCard project={project()} onUploaded={onUploaded} />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Upload a capture" }));
    await user.upload(screen.getByTestId("upload-file"), fileOf(capturePackage()));
    replies = [imported("desktop", 2), { status: 422, body: { error: "Invalid request.", code: "too-many-captures" } }];
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This project has used up its screenshots. The Desktop screenshot was uploaded.",
    );
    // The workspace still re-reads, so the Desktop version shows.
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("upload-panel")).toBeInTheDocument();
  });

  test("a project out of screenshots can't open the panel", () => {
    const full = project();
    full.counts.attempts = MAX_CAPTURE_ATTEMPTS_PER_PROJECT;
    render(
      <ul>
        <UploadCaptureCard project={full} onUploaded={vi.fn()} />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Upload a capture" })).toBeDisabled();
  });
});

describe("Upload a new version and Start from a capture file", () => {
  test("the canvas view's panel always uploads to its own page", async () => {
    const user = userEvent.setup();
    const subject = project();
    const onUploaded = vi.fn();
    render(
      <UploadPanel
        mode={{ kind: "page", project: subject, page: subject.pages[0]!, variant: "desktop" }}
        onUploaded={onUploaded}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Upload a new version" })).toBeInTheDocument();
    await user.upload(screen.getByTestId("upload-file"), fileOf(capturePackage()));
    replies = [imported("desktop", 3), imported("mobile", 3)];
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(expect.anything(), 2));
    expect(sent()[0]!.meta.target).toEqual({ project: "pub-1", page: "page-home" });
    // No page choice here: the page is the one on screen.
    expect(screen.queryByRole("combobox", { name: "Page" })).toBeNull();
  });

  test("a new project starts from the file, named if the editor names it", async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    render(<UploadPanel mode={{ kind: "new-project" }} onUploaded={onUploaded} onCancel={vi.fn()} />);
    await user.upload(screen.getByTestId("upload-file"), fileOf(capturePackage()));
    const name = await screen.findByRole("textbox", { name: /Project name/ });
    expect(name).toHaveAttribute("placeholder", "app.example.com");
    await user.type(name, "Example admin");
    replies = [
      {
        status: 201,
        body: {
          project: { publicId: "pub-new", title: "Example admin", created: true },
          page: { id: "page-new", normalizedUrl: "https://app.example.com/settings", created: true },
          capture: { id: "cap-d", variant: "desktop", attempt: 1, elements: 2 },
        },
      },
      imported("mobile"),
    ];
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(sent()[0]!.meta.target).toEqual({ newProject: { title: "Example admin" } });
    expect(sent()[1]!.meta.target).toEqual({ project: "pub-new", page: "page-new" });
  });

  test("Escape and Cancel leave without uploading", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<UploadPanel mode={{ kind: "new-project" }} onUploaded={vi.fn()} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
