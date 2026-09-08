// The Playwright environment gate, and the repository rule that keeps it the
// only way a spec touches `.env.local`.
//
// CI runs `npm run validate` with no repository secrets, so an e2e spec that
// needs real local configuration must report as skipped there rather than
// failing. These tests cover the parsing/reporting helper and then scan the
// specs themselves, because a future spec reading `.env.local` directly would
// break the CI gate without breaking any other test.

import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  localEnvGate,
  localEnvValue,
  readLocalEnvFile,
  requireLocalEnvValue,
} from "../e2e/local-env";

const E2E_DIR = join(import.meta.dirname, "..", "e2e");

let dir: string;
let envFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pinata-env-gate-"));
  envFile = join(dir, ".env.local");
  writeFileSync(
    envFile,
    [
      "# a comment",
      "",
      "PLAIN=plain-value",
      'QUOTED="quoted value"',
      "export EXPORTED=exported-value",
      "EMPTY=",
      "not a variable line",
      "WITH_EQUALS=a=b",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readLocalEnvFile", () => {
  test("returns an empty map instead of throwing when the file is absent", () => {
    expect(readLocalEnvFile(join(dir, "does-not-exist"))).toEqual({});
  });

  test("parses assignments, strips quotes, and ignores non-assignment lines", () => {
    expect(readLocalEnvFile(envFile)).toEqual({
      PLAIN: "plain-value",
      QUOTED: "quoted value",
      EXPORTED: "exported-value",
      EMPTY: "",
      WITH_EQUALS: "a=b",
    });
  });
});

describe("localEnvValue", () => {
  test("reads a configured variable and reports an absent or empty one as undefined", () => {
    expect(localEnvValue("PLAIN", envFile)).toBe("plain-value");
    expect(localEnvValue("EMPTY", envFile)).toBeUndefined();
    expect(localEnvValue("NEVER_SET_ANYWHERE", envFile)).toBeUndefined();
  });

  test("the real process environment wins, matching how the server resolves it", () => {
    // `next start` inherits the runner's environment, and Next.js gives a real
    // environment variable precedence over the `.env.local` entry.
    const previous = process.env.PLAIN;
    process.env.PLAIN = "from-process-env";
    try {
      expect(localEnvValue("PLAIN", envFile)).toBe("from-process-env");
    } finally {
      if (previous === undefined) delete process.env.PLAIN;
      else process.env.PLAIN = previous;
    }
  });
});

describe("localEnvGate", () => {
  test("is ready when every required variable is configured", () => {
    expect(localEnvGate(["PLAIN", "QUOTED"], envFile)).toEqual({
      ready: true,
      missing: [],
      reason: "",
    });
  });

  test("names only the missing variables, never a configured value", () => {
    const gate = localEnvGate(["PLAIN", "EMPTY", "ABSENT_VAR"], envFile);
    expect(gate.ready).toBe(false);
    expect(gate.missing).toEqual(["EMPTY", "ABSENT_VAR"]);
    expect(gate.reason).toContain("EMPTY, ABSENT_VAR");
    expect(gate.reason).toContain(".env.local");
    expect(gate.reason).not.toContain("plain-value");
    expect(gate.reason).not.toContain("quoted value");
  });

  test("reports the file itself as the gap when nothing is configured", () => {
    const gate = localEnvGate(["ABSENT_ONE", "ABSENT_TWO"], join(dir, "does-not-exist"));
    expect(gate.ready).toBe(false);
    expect(gate.reason).toContain("ABSENT_ONE, ABSENT_TWO");
  });
});

describe("requireLocalEnvValue", () => {
  test("returns the configured value", () => {
    expect(requireLocalEnvValue("QUOTED", envFile)).toBe("quoted value");
  });

  test("throws with the variable name only when it is absent", () => {
    expect(() => requireLocalEnvValue("ABSENT_VAR", envFile)).toThrow(/ABSENT_VAR/);
    expect(() => requireLocalEnvValue("EMPTY", envFile)).toThrow(/EMPTY is not configured/);
  });
});

describe("the e2e specs", () => {
  const specs = readdirSync(E2E_DIR)
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => ({ name, source: readFileSync(join(E2E_DIR, name), "utf8") }));

  test("there are specs to check", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  test("read local configuration only through the shared gate", () => {
    for (const { name, source } of specs) {
      expect(source, `${name} must not read .env.local directly`).not.toContain(".env.local");
    }
  });

  test("skip rather than fail when the configuration they require is absent", () => {
    for (const { name, source } of specs) {
      if (!source.includes("local-env")) continue;
      expect(source, `${name} uses the env gate but never skips on it`).toMatch(
        /test\.skip\(\s*!\w+\.ready/,
      );
    }
  });
});
