// Submission validation: ordering, deduplication, complete per-row
// corrections, limits, and the canonical payload digest
// (VAL-PROJECT-001, VAL-PROJECT-002, VAL-PROJECT-006).

import { describe, expect, test } from "vitest";
import {
  MAX_SUBMITTED_URL_ROWS,
  MAX_UNIQUE_PAGE_URLS,
  PROJECT_TITLE_MAX_CHARS,
} from "../../src/lib/boundaries";
import { validateProjectSubmission } from "../../src/lib/server/projects/submission";

const ok = (result: ReturnType<typeof validateProjectSubmission>) => {
  if (!result.ok) throw new Error(`expected a valid submission, got ${JSON.stringify(result)}`);
  return result;
};

const bad = (result: ReturnType<typeof validateProjectSubmission>) => {
  if (result.ok) throw new Error("expected an invalid submission");
  return result;
};

describe("ordering and identity", () => {
  test("a root-only submission yields exactly one page", () => {
    const result = ok(validateProjectSubmission({ rootUrl: "https://chickpea.co" }));
    expect(result.pages).toEqual([
      { requestedUrl: "https://chickpea.co", normalizedUrl: "https://chickpea.co/", sortIndex: 0 },
    ]);
    expect(result.rootUrl).toBe("https://chickpea.co/");
    expect(result.title).toBe("chickpea.co");
  });

  test("the root is first and explicit rows keep first-seen order", () => {
    const result = ok(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: [
          "https://chickpea.co/pricing",
          "https://chickpea.co/about",
          "https://chickpea.co/privacy",
        ],
      }),
    );
    expect(result.pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
      "https://chickpea.co/privacy",
    ]);
    expect(result.pages.map((page) => page.sortIndex)).toEqual([0, 1, 2, 3]);
  });

  test("public cross-origin rows are allowed and keep their position", () => {
    const result = ok(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: ["https://docs.example.org/guide", "https://chickpea.co/pricing"],
      }),
    );
    expect(result.pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://docs.example.org/guide",
      "https://chickpea.co/pricing",
    ]);
  });

  test("duplicates of the root and of each other collapse to one page", () => {
    const result = ok(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co",
        urls: [
          "https://chickpea.co/",
          "https://CHICKPEA.co/#top",
          "https://chickpea.co/pricing",
          "https://chickpea.co/pricing#plans",
        ],
      }),
    );
    expect(result.pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
    ]);
  });

  test("blank optional rows are ignored without shifting the order", () => {
    const result = ok(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: ["", "https://chickpea.co/pricing", "   ", "https://chickpea.co/about"],
      }),
    );
    expect(result.pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
  });

  test("`/pricing` and `/pricing/` are two pages", () => {
    const result = ok(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: ["https://chickpea.co/pricing", "https://chickpea.co/pricing/"],
      }),
    );
    expect(result.pages).toHaveLength(3);
  });
});

describe("complete per-row corrections", () => {
  test("every invalid row is reported, with its own index and code", () => {
    const result = bad(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: [
          "http://chickpea.co/insecure",
          "https://chickpea.co/pricing",
          "not a url",
          "https://user:pass@chickpea.co/",
          "https://127.0.0.1/",
          "https://chickpea.co:8443/",
        ],
      }),
    );
    expect(result.errors).toEqual([
      { field: "urls", index: 0, code: "scheme" },
      { field: "urls", index: 2, code: "relative" },
      { field: "urls", index: 3, code: "credentials" },
      { field: "urls", index: 4, code: "ip-literal" },
      { field: "urls", index: 5, code: "port" },
    ]);
  });

  test("a blank root is a root error, not an ignored row", () => {
    const result = bad(validateProjectSubmission({ rootUrl: "  ", urls: [""] }));
    expect(result.errors).toEqual([{ field: "rootUrl", index: null, code: "blank" }]);
  });

  test("an invalid root does not suppress row errors", () => {
    const result = bad(
      validateProjectSubmission({ rootUrl: "http://chickpea.co/", urls: ["https://localhost/"] }),
    );
    expect(result.errors).toEqual([
      { field: "rootUrl", index: null, code: "scheme" },
      { field: "urls", index: 0, code: "not-public" },
    ]);
  });

  test("an oversized title is reported on its own field", () => {
    const result = bad(
      validateProjectSubmission({
        title: "t".repeat(PROJECT_TITLE_MAX_CHARS + 1),
        rootUrl: "https://chickpea.co/",
      }),
    );
    expect(result.errors).toContainEqual({ field: "title", index: null, code: "too-long" });
  });
});

describe("limits", () => {
  const rows = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => `https://chickpea.co/${prefix}${index}`);

  test("the submitted-row cap counts the root and is checked before normalization", () => {
    const atLimit = validateProjectSubmission({
      rootUrl: "https://chickpea.co/",
      urls: rows(MAX_SUBMITTED_URL_ROWS - 1, "p"),
    });
    expect(atLimit.ok).toBe(false); // still over the unique-page cap
    expect(bad(atLimit).errors).toEqual([
      { field: "form", index: null, code: "too-many-pages" },
    ]);

    const overLimit = bad(
      validateProjectSubmission({
        rootUrl: "not-a-url",
        urls: rows(MAX_SUBMITTED_URL_ROWS, "p"),
      }),
    );
    // Only the row-count error: no per-row work happened at all.
    expect(overLimit.errors).toEqual([{ field: "form", index: null, code: "too-many-rows" }]);
  });

  test("unique pages at the cap succeed and one more fails", () => {
    const atCap = ok(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: rows(MAX_UNIQUE_PAGE_URLS - 1, "a"),
      }),
    );
    expect(atCap.pages).toHaveLength(MAX_UNIQUE_PAGE_URLS);

    const overCap = bad(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: rows(MAX_UNIQUE_PAGE_URLS, "a"),
      }),
    );
    expect(overCap.errors).toEqual([{ field: "form", index: null, code: "too-many-pages" }]);
  });

  test("duplicate rows do not consume the unique-page budget", () => {
    const result = ok(
      validateProjectSubmission({
        rootUrl: "https://chickpea.co/",
        urls: [...rows(MAX_UNIQUE_PAGE_URLS - 1, "a"), ...rows(MAX_UNIQUE_PAGE_URLS - 1, "a")],
      }),
    );
    expect(result.pages).toHaveLength(MAX_UNIQUE_PAGE_URLS);
  });
});

describe("canonical payload digest", () => {
  const digestOf = (input: Parameters<typeof validateProjectSubmission>[0]) =>
    ok(validateProjectSubmission(input)).payloadDigest;

  test("equivalent submissions share one digest", () => {
    expect(
      digestOf({ rootUrl: "https://chickpea.co", urls: ["https://chickpea.co/pricing#plans"] }),
    ).toBe(
      digestOf({
        rootUrl: " https://CHICKPEA.co/ ",
        urls: ["https://chickpea.co/pricing", "https://chickpea.co/"],
      }),
    );
  });

  test("order, content, and title changes all change the digest", () => {
    const base = digestOf({
      rootUrl: "https://chickpea.co/",
      urls: ["https://chickpea.co/a", "https://chickpea.co/b"],
    });
    const reordered = digestOf({
      rootUrl: "https://chickpea.co/",
      urls: ["https://chickpea.co/b", "https://chickpea.co/a"],
    });
    const extra = digestOf({
      rootUrl: "https://chickpea.co/",
      urls: ["https://chickpea.co/a", "https://chickpea.co/b", "https://chickpea.co/c"],
    });
    const retitled = digestOf({
      title: "Chickpea review",
      rootUrl: "https://chickpea.co/",
      urls: ["https://chickpea.co/a", "https://chickpea.co/b"],
    });
    expect(new Set([base, reordered, extra, retitled]).size).toBe(4);
  });
});
