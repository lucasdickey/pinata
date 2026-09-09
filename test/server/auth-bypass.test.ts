// Focused tests for the local-only editor auth bypass (D052, user-directed
// 2026-09-09): PINATA_AUTH_DISABLED=1 makes server-side session verification
// treat every request as an authenticated editor with a synthetic session;
// unset (or any other value) keeps the real auth posture byte-identical.
// The flag is server-only and is never set in .env.local, so these tests
// stub the environment explicitly. All secrets here are non-production test
// sentinels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GET as sessionGET } from "../../app/api/editor/session/route";
import { POST as loginPOST } from "../../app/api/auth/login/route";
import {
  requireEditor,
  requireEditorMutation,
} from "../../src/lib/server/auth/guard";
import { isAuthDisabled } from "../../src/lib/server/auth/bypass";
import {
  createEditorSession,
  __clearRevokedSessionsForTests,
} from "../../src/lib/server/auth/session";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "bypass-test-session-secret-sentinel";
const TEST_PASSWORD = "bypass-test-editor-password-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const SESSION_URL = `${ORIGIN}/api/editor/session`;
const LOGIN_URL = `${ORIGIN}/api/auth/login`;

afterEach(() => {
  vi.unstubAllEnvs();
  __clearRevokedSessionsForTests();
});

describe("isAuthDisabled flag parsing", () => {
  test("unset means off", () => {
    vi.stubEnv("PINATA_AUTH_DISABLED", "");
    expect(isAuthDisabled()).toBe(false);
  });

  test("only the exact value \"1\" enables the bypass", () => {
    vi.stubEnv("PINATA_AUTH_DISABLED", "1");
    expect(isAuthDisabled()).toBe(true);
    for (const other of ["0", "true", "yes", "on", "2", " 1", "1 "]) {
      vi.stubEnv("PINATA_AUTH_DISABLED", other);
      expect(isAuthDisabled(), `value ${JSON.stringify(other)}`).toBe(false);
    }
  });
});

describe("bypass enabled (PINATA_AUTH_DISABLED=1)", () => {
  beforeEach(() => {
    vi.stubEnv("PINATA_AUTH_DISABLED", "1");
    // Deliberately no SESSION_SECRET: the bypass must not depend on secrets.
    vi.stubEnv("SESSION_SECRET", "");
  });

  test("requireEditor authorizes an anonymous request with a synthetic session", () => {
    const result = requireEditor(new Request(SESSION_URL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.v).toBe(1);
    expect(result.session.sid).toBe("auth-disabled-local");
    expect(result.session.exp).toBeGreaterThan(Date.now());
    expect(result.renewedToken).toBeNull();
  });

  test("requireEditorMutation authorizes without a cookie or CSRF proof", () => {
    const result = requireEditorMutation(
      new Request(SESSION_URL, { method: "POST", headers: { origin: ORIGIN } }),
    );
    expect(result.ok).toBe(true);
  });

  test("GET /api/editor/session returns an authenticated editor response", async () => {
    const response = await sessionGET(new Request(SESSION_URL));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      authenticated: boolean;
      actor: string;
      expiresAt: string;
    };
    expect(body.authenticated).toBe(true);
    expect(body.actor).toBe("editor");
    expect(typeof body.expiresAt).toBe("string");
  });

  test("the login route keeps working in bypass mode", async () => {
    let testDb: TestDb | undefined;
    try {
      vi.stubEnv("EDITOR_PASSWORD", TEST_PASSWORD);
      vi.stubEnv("SESSION_SECRET", TEST_SECRET);
      testDb = await createTestDb();
      __setDatabaseForTests(testDb.db);
      const response = await loginPOST(
        new Request(LOGIN_URL, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json" },
          body: JSON.stringify({ password: TEST_PASSWORD }),
        }),
      );
      expect(response.status).toBe(200);
      expect(
        response.headers
          .getSetCookie()
          .some((c) => c.startsWith(`${EDITOR_SESSION_COOKIE}=`)),
      ).toBe(true);
    } finally {
      testDb?.client.close();
      __resetDatabaseCacheForTests();
    }
  });
});

describe("bypass disabled (flag unset): default posture is unchanged", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  });

  test("anonymous requests are denied the editor session read", async () => {
    const response = await sessionGET(new Request(SESSION_URL));
    expect(response.status).toBe(401);
    expect(requireEditor(new Request(SESSION_URL)).ok).toBe(false);
  });

  test("a valid session without its CSRF proof is still denied mutations", () => {
    const { token } = createEditorSession(TEST_SECRET, Date.now());
    const result = requireEditorMutation(
      new Request(SESSION_URL, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie: `${EDITOR_SESSION_COOKIE}=${token}`,
          [EDITOR_CSRF_HEADER]: "wrong-proof",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  test("a valid session with its CSRF proof still authorizes", () => {
    const { token, payload } = createEditorSession(TEST_SECRET, Date.now());
    const result = requireEditorMutation(
      new Request(SESSION_URL, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie: `${EDITOR_SESSION_COOKIE}=${token}`,
          [EDITOR_CSRF_HEADER]: payload.csrf,
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("missing SESSION_SECRET still fails closed with 503", () => {
    vi.stubEnv("SESSION_SECRET", "");
    const result = requireEditor(new Request(SESSION_URL));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
  });
});

describe("server-only boundary source checks (D052)", () => {
  const ROOT = process.cwd();

  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) yield* sourceFiles(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
    }
  }

  test("no client-reachable module names the bypass flag", () => {
    const offenders: string[] = [];
    for (const base of ["src", "app"]) {
      for (const file of sourceFiles(join(ROOT, base))) {
        const content = readFileSync(file, "utf8");
        const isClientModule =
          /["']use client["']/.test(content) || file.includes(join("src", "components"));
        if (!isClientModule) continue;
        if (/PINATA_AUTH_DISABLED/.test(content)) {
          offenders.push(`${file}: names PINATA_AUTH_DISABLED`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the flag is server-only, not NEXT_PUBLIC_*, and not in .env.local", () => {
    const bypass = readFileSync(
      join(ROOT, "src/lib/server/auth/bypass.ts"),
      "utf8",
    );
    expect(bypass).toContain("process.env.PINATA_AUTH_DISABLED");
    expect(bypass).not.toContain("use client");
    // The flag itself is never NEXT_PUBLIC_-exposed (the module's prose
    // comments name the constraint, so assert the env read, not the word).
    expect(bypass).not.toMatch(/process\.env\.NEXT_PUBLIC/);
    // .env.local is git-ignored and may be absent (CI); when present, the
    // flag must never be in it. Boolean assertion only, so a failure never
    // prints the file's secret-bearing contents.
    let envLocal: string | null = null;
    try {
      envLocal = readFileSync(join(ROOT, ".env.local"), "utf8");
    } catch {
      envLocal = null;
    }
    expect(envLocal === null || !envLocal.includes("PINATA_AUTH_DISABLED")).toBe(true);
  });
});
