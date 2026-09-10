// @vitest-environment jsdom
// The optional URL-array editor (VAL-PROJECT-006): stable keyboard-operable
// row identities, complete per-row corrections that preserve the other rows
// and their order, credential-bearing input dropped rather than retained, and
// a Cancel that writes nothing.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectCreateForm } from "../src/components/project-create-form";

const onCreated = vi.fn();
const onCancel = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const created = {
  project: {
    projectId: "p1",
    publicId: "pub1",
    title: "chickpea.co",
    rootUrl: "https://chickpea.co/",
    pages: [],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onCreated.mockReset();
  onCancel.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Vitest runs without globals, so React Testing Library's automatic
  // cleanup is not registered for us.
  cleanup();
  vi.unstubAllGlobals();
});

const rowInputs = () => screen.queryAllByRole("textbox", { name: /^URL \d+$/ });

async function addRows(user: ReturnType<typeof userEvent.setup>, values: string[]) {
  for (const value of values) {
    await user.click(screen.getByRole("button", { name: "Add URL" }));
    const inputs = rowInputs();
    await user.type(inputs[inputs.length - 1]!, value);
  }
}

function renderForm() {
  render(<ProjectCreateForm onCreated={onCreated} onCancel={onCancel} />);
}

describe("keyboard-operable rows", () => {
  test("rows are added, reordered, and removed entirely from the keyboard", async () => {
    const user = userEvent.setup();
    renderForm();

    // Reach and operate "Add URL" with the keyboard only.
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Add URL" })).toHaveFocus();
    await user.keyboard("{Enter}");
    // Focus lands on the new row's input so typing continues immediately.
    expect(rowInputs()[0]).toHaveFocus();
    await user.keyboard("https://chickpea.co/pricing");

    await user.click(screen.getByRole("button", { name: "Add URL" }));
    await user.keyboard("https://chickpea.co/about");
    expect(rowInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);

    // Reorder with the row's own controls.
    await user.click(screen.getByRole("button", { name: "Move URL 3 up" }));
    expect(rowInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "https://chickpea.co/about",
      "https://chickpea.co/pricing",
    ]);

    await user.click(screen.getByRole("button", { name: "Move URL 2 down" }));
    expect(rowInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);

    await user.click(screen.getByRole("button", { name: "Remove URL 2" }));
    expect(rowInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "https://chickpea.co/about",
    ]);
    // Focus stays inside the list rather than resetting to the document.
    expect(rowInputs()[0]).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Remove URL 2" }));
    expect(rowInputs()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add URL" })).toHaveFocus();
  });

  test("the first and last rows cannot be moved out of the list", async () => {
    const user = userEvent.setup();
    renderForm();
    await addRows(user, ["https://chickpea.co/a", "https://chickpea.co/b"]);
    expect(screen.getByRole("button", { name: "Move URL 2 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move URL 3 down" })).toBeDisabled();
  });
});

describe("server corrections", () => {
  test("every invalid row is marked, other rows and their order survive", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Root URL"), "https://chickpea.co");
    await addRows(user, [
      "http://chickpea.co/insecure",
      "https://chickpea.co/pricing",
      "https://127.0.0.1/admin",
    ]);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: "Invalid request.",
        errors: [
          { field: "urls", index: 0, code: "scheme" },
          { field: "urls", index: 2, code: "ip-literal" },
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));

    const alerts = screen.getAllByRole("alert").map((node) => node.textContent);
    expect(alerts).toEqual([
      "Only public https:// addresses can be captured.",
      "Enter a public domain name, not an IP address.",
    ]);
    // Values and order are preserved so the editor can correct in place.
    expect(rowInputs().map((input) => (input as HTMLInputElement).value)).toEqual([
      "http://chickpea.co/insecure",
      "https://chickpea.co/pricing",
      "https://127.0.0.1/admin",
    ]);
    const invalid = rowInputs().filter((input) => input.getAttribute("aria-invalid") === "true");
    expect(invalid).toHaveLength(2);
    expect(onCreated).not.toHaveBeenCalled();
  });

  test("credential-bearing input is cleared instead of retained", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Root URL"), "https://user:pass@chickpea.co");
    await addRows(user, ["https://admin:secret@chickpea.co/pricing"]);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: "Invalid request.",
        errors: [
          { field: "rootUrl", index: null, code: "credentials" },
          { field: "urls", index: 0, code: "credentials" },
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(screen.getByLabelText("Root URL")).toHaveValue("");
    expect(rowInputs()[0]).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("secret");
    expect(document.body.innerHTML).not.toContain("user:pass");
  });

  test("a form-level limit is reported once, without row noise", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Root URL"), "https://chickpea.co");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        error: "Invalid request.",
        errors: [{ field: "form", index: null, code: "too-many-pages" }],
      }),
    );
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toMatch(/unique pages per project/);
  });
});

describe("submission", () => {
  test("the request carries exactly the typed rows, in order, with one idempotency key", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Project name (optional)"), "Chickpea review");
    await user.type(screen.getByLabelText("Root URL"), "https://chickpea.co");
    await addRows(user, ["https://chickpea.co/pricing", "https://chickpea.co/about"]);

    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/projects");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe("Chickpea review");
    expect(body.rootUrl).toBe("https://chickpea.co");
    expect(body.urls).toEqual(["https://chickpea.co/pricing", "https://chickpea.co/about"]);
    expect(typeof body.idempotencyKey).toBe("string");
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(onCreated).toHaveBeenCalledWith(created.project);
  });

  test("retrying an unchanged submission reuses the same idempotency key", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Root URL"), "https://chickpea.co");

    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: "Service unavailable." }));
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(screen.getByRole("alert").textContent).toMatch(/try again/i);

    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    const first = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  test("a new submission after a success uses a fresh key", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Root URL"), "https://chickpea.co");
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    await user.type(screen.getByLabelText("Root URL"), "https://example.com");
    fetchMock.mockResolvedValueOnce(jsonResponse(201, created));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    const first = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  test("Clear form sends no request and clears what was typed", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Root URL"), "https://chickpea.co");
    await addRows(user, ["https://chickpea.co/pricing"]);

    await user.click(screen.getByRole("button", { name: "Clear form" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Root URL")).toHaveValue("");
    expect(rowInputs()).toHaveLength(0);
  });

  test("the form states plainly that Pinata never follows links", async () => {
    renderForm();
    const fieldset = screen.getByRole("group", { name: "Additional URLs (optional)" });
    expect(within(fieldset).getByText(/never follows links/i)).toBeInTheDocument();
  });
});
