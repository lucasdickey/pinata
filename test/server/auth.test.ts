// Focused unit tests for the server-only editor authentication boundary
// (VAL-AUTH-001, VAL-AUTH-010). All secrets here are non-production test
// sentinels; real environment values are never used or printed.

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_REQUEST_MAX_BYTES,
  EDITOR_PASSWORD_MAX_CHARS,
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
} from "../../src/lib/boundaries";
import { verifyEditorPassword } from "../../src/lib/server/auth/password";
import {
  createEditorSession,
  renewEditorSessionToken,
  revokeEditorSession,
  verifyEditorSessionToken,
  __clearRevokedSessionsForTests,
} from "../../src/lib/server/auth/session";
import {
  clearCsrfCookie,
  clearSessionCookie,
  csrfCookie,
  sessionCookie,
} from "../../src/lib/server/auth/cookies";
import { EDITOR_CSRF_COOKIE, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  hasSameOrigin,
  isSecureRequest,
  parseCookieHeader,
  readBoundedJson,
} from "../../src/lib/server/http";
import { loginBodySchema } from "../../src/lib/server/auth/schemas";

const TEST_SECRET = "test-session-secret-not-a-real-value";
const TEST_PASSWORD = "test-editor-password-not-a-real-value";

describe("editor password verifier (VAL-AUTH-010)", () => {
  test("accepts the exact configured password", () => {
    expect(verifyEditorPassword(TEST_PASSWORD, TEST_PASSWORD)).toBe(true);
  });

  test("rejects a wrong password of the same length", () => {
    expect(verifyEditorPassword(`${TEST_PASSWORD.slice(0, -1)}X`, TEST_PASSWORD)).toBe(false);
  });

  test("rejects unequal-length input without throwing", () => {
    expect(verifyEditorPassword("short", TEST_PASSWORD)).toBe(false);
    expect(verifyEditorPassword(TEST_PASSWORD + TEST_PASSWORD, TEST_PASSWORD)).toBe(false);
  });

  test("rejects empty input without throwing", () => {
    expect(verifyEditorPassword("", TEST_PASSWORD)).toBe(false);
  });

  test("rejects oversized input without throwing", () => {
    expect(verifyEditorPassword("x".repeat(100_000), TEST_PASSWORD)).toBe(false);
  });

  test("handles arbitrary Unicode without throwing or bypassing", () => {
    expect(verifyEditorPassword("pässwörd🔒€𝕏", TEST_PASSWORD)).toBe(false);
    expect(verifyEditorPassword("pässwörd🔒€𝕏", "pässwörd🔒€𝕏")).toBe(true);
  });

  test("rejects non-string input without throwing", () => {
    for (const value of [undefined, null, 42, true, {}, [TEST_PASSWORD]]) {
      expect(verifyEditorPassword(value, TEST_PASSWORD)).toBe(false);
    }
  });

  test("fails closed when the configured password is missing or empty", () => {
    expect(verifyEditorPassword(TEST_PASSWORD, undefined)).toBe(false);
    expect(verifyEditorPassword("", undefined)).toBe(false);
    expect(verifyEditorPassword("", "")).toBe(false);
  });
});

describe("editor session tokens (VAL-AUTH-003 foundations)", () => {
  const NOW = 1_800_000_000_000;

  test("a freshly created session verifies and is not up for renewal", () => {
    const { token, payload } = createEditorSession(TEST_SECRET, NOW);
    const result = verifyEditorSessionToken(token, TEST_SECRET, NOW);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.payload.sid).toBe(payload.sid);
    expect(result.payload.csrf).toBe(payload.csrf);
    expect(result.payload.iat).toBe(NOW);
    expect(result.payload.exp).toBe(NOW + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS);
    expect(result.renew).toBe(false);
  });

  test("is valid immediately before expiry and denied immediately after", () => {
    const { token } = createEditorSession(TEST_SECRET, NOW);
    const expiry = NOW + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS;
    expect(verifyEditorSessionToken(token, TEST_SECRET, expiry - 1).status).toBe("valid");
    expect(verifyEditorSessionToken(token, TEST_SECRET, expiry).status).toBe("invalid");
    expect(verifyEditorSessionToken(token, TEST_SECRET, expiry + 1).status).toBe("invalid");
  });

  test("renews only inside the renewal threshold and resets absolute expiry", () => {
    const { token, payload } = createEditorSession(TEST_SECRET, NOW);
    const outside = NOW + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS - EDITOR_SESSION_RENEWAL_THRESHOLD_MS - 1;
    const notDue = verifyEditorSessionToken(token, TEST_SECRET, outside);
    expect(notDue.status).toBe("valid");
    if (notDue.status === "valid") expect(notDue.renew).toBe(false);

    const inside = NOW + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS - EDITOR_SESSION_RENEWAL_THRESHOLD_MS + 1;
    const due = verifyEditorSessionToken(token, TEST_SECRET, inside);
    expect(due.status).toBe("valid");
    if (due.status !== "valid") return;
    expect(due.renew).toBe(true);

    const renewedToken = renewEditorSessionToken(due.payload, TEST_SECRET, inside);
    const renewed = verifyEditorSessionToken(renewedToken, TEST_SECRET, inside);
    expect(renewed.status).toBe("valid");
    if (renewed.status !== "valid") return;
    expect(renewed.payload.exp).toBe(inside + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS);
    // Renewal keeps the session identity and CSRF proof stable.
    expect(renewed.payload.sid).toBe(payload.sid);
    expect(renewed.payload.csrf).toBe(payload.csrf);
    expect(renewed.renew).toBe(false);
  });

  test("rejects forged signatures and tampered payloads", () => {
    const { token } = createEditorSession(TEST_SECRET, NOW);
    expect(verifyEditorSessionToken(token, "wrong-secret", NOW).status).toBe("invalid");

    const [v, payloadPart] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      exp: number;
    };
    payload.exp = payload.exp + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS;
    const tampered = `${v}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${token.split(".")[2]}`;
    expect(verifyEditorSessionToken(tampered, TEST_SECRET, NOW).status).toBe("invalid");
  });

  test("rejects malformed tokens without throwing", () => {
    for (const bad of ["", "abc", "v1..sig", "v1.not-base64.sig", "v2.x.y", "v1.e30=.!!!!"]) {
      expect(verifyEditorSessionToken(bad, TEST_SECRET, NOW).status).toBe("invalid");
    }
  });

  test("a logged-out (revoked) session fails even before expiry", () => {
    __clearRevokedSessionsForTests();
    const { token, payload } = createEditorSession(TEST_SECRET, NOW);
    expect(verifyEditorSessionToken(token, TEST_SECRET, NOW).status).toBe("valid");
    revokeEditorSession(payload.sid, payload.exp);
    expect(verifyEditorSessionToken(token, TEST_SECRET, NOW).status).toBe("invalid");
    __clearRevokedSessionsForTests();
  });

  test("two sessions never share identity or CSRF proof", () => {
    const a = createEditorSession(TEST_SECRET, NOW);
    const b = createEditorSession(TEST_SECRET, NOW);
    expect(a.payload.sid).not.toBe(b.payload.sid);
    expect(a.payload.csrf).not.toBe(b.payload.csrf);
    expect(a.token).not.toBe(b.token);
  });
});

describe("session cookies", () => {
  test("session cookie is HttpOnly, SameSite=Strict, path /, with Secure when deployed", () => {
    const secure = sessionCookie("token-value", true);
    expect(secure).toContain(`${EDITOR_SESSION_COOKIE}=token-value`);
    expect(secure).toContain("HttpOnly");
    expect(secure).toContain("SameSite=Strict");
    expect(secure).toContain("Path=/");
    expect(secure).toContain("Secure");
    expect(secure).toContain(`Max-Age=${EDITOR_SESSION_ABSOLUTE_LIFETIME_MS / 1000}`);

    const local = sessionCookie("token-value", false);
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Strict");
    expect(local).not.toContain("Secure");
  });

  test("CSRF cookie is browser-readable but otherwise identically scoped", () => {
    const cookie = csrfCookie("csrf-value", true);
    expect(cookie).toContain(`${EDITOR_CSRF_COOKIE}=csrf-value`);
    expect(cookie).not.toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
  });

  test("clearing cookies uses matching attributes so the browser honors them", () => {
    for (const cleared of [clearSessionCookie(true), clearCsrfCookie(true)]) {
      expect(cleared).toContain("Max-Age=0");
      expect(cleared).toContain("Path=/");
      expect(cleared).toContain("SameSite=Strict");
      expect(cleared).toContain("Secure");
    }
    expect(clearSessionCookie(true)).toContain("HttpOnly");
  });

  test("cookie header parsing is robust", () => {
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
    expect(parseCookieHeader("a=1; b=two; malformed; c=")).toEqual({ a: "1", b: "two", c: "" });
  });
});

describe("login request schema", () => {
  test("accepts a plain password string", () => {
    expect(loginBodySchema.safeParse({ password: "x" }).success).toBe(true);
  });

  test("rejects empty, non-string, oversized, and extra-field bodies", () => {
    expect(loginBodySchema.safeParse({}).success).toBe(false);
    expect(loginBodySchema.safeParse({ password: "" }).success).toBe(false);
    expect(loginBodySchema.safeParse({ password: 42 }).success).toBe(false);
    expect(loginBodySchema.safeParse({ password: ["x"] }).success).toBe(false);
    expect(loginBodySchema.safeParse({ password: "x".repeat(EDITOR_PASSWORD_MAX_CHARS + 1) }).success).toBe(false);
    expect(loginBodySchema.safeParse({ password: "x", username: "lucas" }).success).toBe(false);
    expect(loginBodySchema.safeParse("password").success).toBe(false);
  });

  test("accepts exactly the maximum length", () => {
    expect(loginBodySchema.safeParse({ password: "x".repeat(EDITOR_PASSWORD_MAX_CHARS) }).success).toBe(true);
  });
});

describe("origin and transport boundaries (VAL-AUTH-001)", () => {
  const req = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { method: "POST", headers });

  test("same-origin POSTs pass", () => {
    expect(
      hasSameOrigin(req("http://127.0.0.1:3100/api/auth/login", { origin: "http://127.0.0.1:3100" })),
    ).toBe(true);
    expect(
      hasSameOrigin(req("https://pinata.vercel.app/api/auth/login", { origin: "https://pinata.vercel.app" })),
    ).toBe(true);
  });

  test("the Host header is authoritative when the framework normalizes the URL host", () => {
    // Regression: Next.js normalized request.url to localhost while browsers
    // address 127.0.0.1; the addressed Host header must win.
    const normalized = new Request("http://localhost:3100/api/auth/login", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" },
    });
    expect(hasSameOrigin(normalized)).toBe(true);

    const poisonedHost = new Request("http://127.0.0.1:3100/api/auth/login", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3100", host: "evil.example" },
    });
    expect(hasSameOrigin(poisonedHost)).toBe(false);
  });

  test("missing, malformed, and foreign origins fail", () => {
    expect(hasSameOrigin(req("http://127.0.0.1:3100/api/auth/login"))).toBe(false);
    expect(
      hasSameOrigin(req("http://127.0.0.1:3100/api/auth/login", { origin: "not a url" })),
    ).toBe(false);
    expect(
      hasSameOrigin(req("http://127.0.0.1:3100/api/auth/login", { origin: "https://evil.example" })),
    ).toBe(false);
    expect(
      hasSameOrigin(req("https://pinata.vercel.app/api/auth/login", { origin: "https://pinata.vercel.app.evil.example" })),
    ).toBe(false);
  });

  test("non-local http origins fail even with a matching host", () => {
    expect(
      hasSameOrigin(req("https://pinata.vercel.app/api/auth/login", { origin: "http://pinata.vercel.app" })),
    ).toBe(false);
  });

  test("secure detection follows the request URL protocol", () => {
    expect(isSecureRequest(req("https://pinata.vercel.app/api/auth/login"))).toBe(true);
    expect(isSecureRequest(req("http://127.0.0.1:3100/api/auth/login"))).toBe(false);
  });

  test("bounded JSON reader enforces content type, size cap, and JSON shape", async () => {
    const json = (body: string, headers: Record<string, string> = {}) =>
      new Request("http://127.0.0.1:3100/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      });

    expect(await readBoundedJson(json('{"password":"x"}'), AUTH_REQUEST_MAX_BYTES)).toEqual({
      ok: true,
      value: { password: "x" },
    });

    const wrongType = await readBoundedJson(
      new Request("http://127.0.0.1:3100/api/auth/login", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: '{"password":"x"}',
      }),
      AUTH_REQUEST_MAX_BYTES,
    );
    expect(wrongType).toEqual({ ok: false, error: "content-type" });

    const declaredTooBig = await readBoundedJson(
      json("{}", { "content-length": String(AUTH_REQUEST_MAX_BYTES + 1) }),
      AUTH_REQUEST_MAX_BYTES,
    );
    expect(declaredTooBig).toEqual({ ok: false, error: "too-large" });

    const actuallyTooBig = await readBoundedJson(
      json(`{"password":"${"x".repeat(AUTH_REQUEST_MAX_BYTES)}"}`),
      AUTH_REQUEST_MAX_BYTES,
    );
    expect(actuallyTooBig).toEqual({ ok: false, error: "too-large" });

    const malformed = await readBoundedJson(json("{not json"), AUTH_REQUEST_MAX_BYTES);
    expect(malformed).toEqual({ ok: false, error: "invalid-json" });
  });
});

describe("server-only boundary source checks (VAL-AUTH-010)", () => {
  const ROOT = process.cwd();

  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) yield* sourceFiles(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
    }
  }

  test("no client-reachable module imports the verifier, secrets, or node crypto", () => {
    const offenders: string[] = [];
    for (const base of ["src", "app"]) {
      for (const file of sourceFiles(join(ROOT, base))) {
        const content = readFileSync(file, "utf8");
        const isClientModule = /["']use client["']/.test(content) || file.includes(join("src", "components"));
        if (!isClientModule) continue;
        if (/lib\/server/.test(content)) offenders.push(`${file}: imports lib/server`);
        if (/node:crypto|from\s+["']crypto["']/.test(content)) offenders.push(`${file}: imports crypto`);
        if (/EDITOR_PASSWORD|SESSION_SECRET/.test(content)) offenders.push(`${file}: names a secret env var`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the verifier and secret accessors live only in server-only modules", () => {
    const verifier = readFileSync(join(ROOT, "src/lib/server/auth/password.ts"), "utf8");
    expect(verifier).toContain("timingSafeEqual");
    expect(verifier).not.toContain("use client");
    const secrets = readFileSync(join(ROOT, "src/lib/server/auth/secrets.ts"), "utf8");
    expect(secrets).toContain("process.env");
  });
});
