// Client-side URL completion (D097). The forms finish what people actually
// type — a bare domain, a path relative to the root — before the strict
// server boundary sees it, and never add or upgrade to http://.

import { describe, expect, test } from "vitest";
import { checkUrlInput, completeUrlInput } from "../src/lib/url/complete";

describe("completeUrlInput", () => {
  test.each([
    ["chickpea.co", "https://chickpea.co"],
    ["www.chickpea.co/pricing", "https://www.chickpea.co/pricing"],
    ["  chickpea.co/about?ref=x  ", "https://chickpea.co/about?ref=x"],
    ["//chickpea.co/pricing", "https://chickpea.co/pricing"],
    ["chickpea.co:8443", "https://chickpea.co:8443"],
  ])("a bare address %s gains https://", (input, expected) => {
    expect(completeUrlInput(input)).toBe(expected);
  });

  test.each([
    "https://chickpea.co/",
    "HTTPS://chickpea.co/",
    "http://chickpea.co/insecure",
    "ftp://chickpea.co/",
    "javascript:alert(1)",
    "mailto:someone@chickpea.co",
    "localhost:3000",
  ])("%s already names a scheme and is left exactly as typed", (input) => {
    expect(completeUrlInput(input)).toBe(input);
  });

  test.each(["", "   ", "pricing", "not a url"])(
    "%j has nothing to complete and comes back trimmed",
    (input) => {
      expect(completeUrlInput(input)).toBe(input.trim());
    },
  );

  test("a row starting with / resolves against the root", () => {
    expect(completeUrlInput("/pricing", "https://chickpea.co")).toBe("https://chickpea.co/pricing");
    expect(completeUrlInput("/pricing", "https://chickpea.co/?run=1")).toBe(
      "https://chickpea.co/pricing",
    );
    expect(completeUrlInput("/pricing?plan=pro", "https://chickpea.co/about")).toBe(
      "https://chickpea.co/pricing?plan=pro",
    );
  });

  test("the root is completed first when it is itself a bare domain", () => {
    expect(completeUrlInput("/pricing", "chickpea.co")).toBe("https://chickpea.co/pricing");
  });

  test("a / row stays as typed when the root is missing or not https", () => {
    expect(completeUrlInput("/pricing")).toBe("/pricing");
    expect(completeUrlInput("/pricing", "")).toBe("/pricing");
    expect(completeUrlInput("/pricing", "http://chickpea.co")).toBe("/pricing");
  });

  test("never produces http://", () => {
    for (const input of ["chickpea.co", "www.chickpea.co/x", "/x", "//chickpea.co"]) {
      expect(completeUrlInput(input, "chickpea.co")).not.toMatch(/^http:/i);
    }
  });
});

describe("checkUrlInput", () => {
  test("applies the server's own admission rules to the completed value", () => {
    expect(checkUrlInput("chickpea.co")).toEqual({
      value: "https://chickpea.co",
      result: { ok: true, url: "https://chickpea.co/" },
    });
    expect(checkUrlInput("http://chickpea.co").result).toEqual({ ok: false, reason: "scheme" });
    expect(checkUrlInput("pricing").result).toEqual({ ok: false, reason: "relative" });
    expect(checkUrlInput("127.0.0.1").result).toEqual({ ok: false, reason: "ip-literal" });
    expect(checkUrlInput("chickpea.co:8443").result).toEqual({ ok: false, reason: "port" });
    expect(checkUrlInput("/pricing", "chickpea.co").result).toEqual({
      ok: true,
      url: "https://chickpea.co/pricing",
    });
  });
});
