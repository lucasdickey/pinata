import { describe, expect, test } from "vitest";
import { parseEditorAddress, projectEditorUrl } from "../src/lib/editor-url";

describe("editor addresses", () => {
  test("retains the extension's project-only address", () => {
    expect(projectEditorUrl({ project: "pub&1" })).toBe("/pins?project=pub%261");
    expect(parseEditorAddress("?project=pub%261")).toEqual({ project: "pub&1" });
  });

  test("round-trips page, device, capture version, and note identities", () => {
    const address = {
      project: "pub-1",
      page: "page-2",
      device: "mobile" as const,
      capture: "cap-older",
      note: "note-3",
    };
    expect(parseEditorAddress(projectEditorUrl(address).split("?")[1]!)).toEqual(address);
  });

  test("incomplete device addresses fall back to the project's overview", () => {
    expect(parseEditorAddress("?project=pub-1&page=page-2&device=tablet&note=x")).toEqual({
      project: "pub-1",
    });
    expect(parseEditorAddress("?page=page-2&device=desktop")).toBeNull();
  });
});
