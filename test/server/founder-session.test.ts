// Focused unit tests for the founder capability session and its cookies:
// signing, tamper and expiry rejection, the project/version binding, the
// editor/founder token domain separation, renewal, and the cookie attribute
// policy mirrored from the editor session. All secrets are test sentinels.

import { describe, expect, test } from "vitest";
import { FOUNDER_CSRF_COOKIE, FOUNDER_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
} from "../../src/lib/boundaries";
import { createEditorSession, verifyEditorSessionToken } from "../../src/lib/server/auth/session";
import {
  clearFounderCsrfCookie,
  clearFounderSessionCookie,
  founderCsrfCookie,
  founderSessionCookie,
} from "../../src/lib/server/founder/cookies";
import {
  createFounderSession,
  renewFounderSessionToken,
  verifyFounderSessionToken,
} from "../../src/lib/server/founder/session";

const SECRET = "founder-session-test-secret-sentinel";
const T0 = 1_800_000_000_000;
const BINDING = { projectId: "proj-1", version: 3 };

describe("founder session tokens", () => {
  test("a fresh session binds to the project and capability version", () => {
    const { token, payload } = createFounderSession(SECRET, BINDING, T0);
    expect(payload).toMatchObject({ v: 1, role: "founder", pid: "proj-1", ver: 3, iat: T0 });
    expect(payload.exp).toBe(T0 + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS);
    expect(payload.sid.length).toBeGreaterThan(10);
    expect(payload.csrf.length).toBeGreaterThan(10);
    const verified = verifyFounderSessionToken(token, SECRET, T0 + 1);
    expect(verified.status).toBe("valid");
    if (verified.status === "valid") {
      expect(verified.payload).toEqual(payload);
      expect(verified.renew).toBe(false);
    }
  });

  test("tampered, wrong-secret, malformed, and expired tokens are invalid", () => {
    const { token, payload } = createFounderSession(SECRET, BINDING, T0);
    expect(verifyFounderSessionToken(`${token.slice(0, -2)}xx`, SECRET, T0).status).toBe("invalid");
    expect(verifyFounderSessionToken(token, "another-secret", T0).status).toBe("invalid");
    expect(verifyFounderSessionToken("", SECRET, T0).status).toBe("invalid");
    expect(verifyFounderSessionToken("f1.abc", SECRET, T0).status).toBe("invalid");
    expect(verifyFounderSessionToken(token, SECRET, payload.exp).status).toBe("invalid");
    expect(verifyFounderSessionToken(token, SECRET, payload.exp - 1).status).toBe("valid");
  });

  test("a re-signed payload with a different binding is a different token", () => {
    const [a, b] = [
      createFounderSession(SECRET, { projectId: "proj-1", version: 1 }, T0),
      createFounderSession(SECRET, { projectId: "proj-2", version: 1 }, T0),
    ];
    // Splicing project 2's payload onto project 1's signature fails.
    const spliced = `${b.token.split(".").slice(0, 2).join(".")}.${a.token.split(".")[2]}`;
    expect(verifyFounderSessionToken(spliced, SECRET, T0).status).toBe("invalid");
  });

  test("editor and founder tokens never verify as each other", () => {
    const founder = createFounderSession(SECRET, BINDING, T0);
    const editor = createEditorSession(SECRET, T0);
    expect(verifyFounderSessionToken(editor.token, SECRET, T0).status).toBe("invalid");
    expect(verifyEditorSessionToken(founder.token, SECRET, T0).status).toBe("invalid");
  });

  test("renewal is offered only inside the threshold and preserves the binding", () => {
    const { token, payload } = createFounderSession(SECRET, BINDING, T0);
    const outside = verifyFounderSessionToken(
      token,
      SECRET,
      payload.exp - EDITOR_SESSION_RENEWAL_THRESHOLD_MS - 1,
    );
    expect(outside).toMatchObject({ status: "valid", renew: false });
    const inside = verifyFounderSessionToken(
      token,
      SECRET,
      payload.exp - EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
    );
    expect(inside).toMatchObject({ status: "valid", renew: true });

    const later = payload.exp - 1_000;
    const renewed = renewFounderSessionToken(payload, SECRET, later);
    const verified = verifyFounderSessionToken(renewed, SECRET, later);
    expect(verified.status).toBe("valid");
    if (verified.status === "valid") {
      expect(verified.payload.exp).toBe(later + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS);
      expect(verified.payload.pid).toBe("proj-1");
      expect(verified.payload.ver).toBe(3);
      expect(verified.payload.sid).toBe(payload.sid);
      expect(verified.payload.csrf).toBe(payload.csrf);
    }
  });
});

describe("founder cookies", () => {
  test("the session cookie is HttpOnly, SameSite=Strict, path /, Secure when deployed", () => {
    const secure = founderSessionCookie("tok", true);
    expect(secure).toContain(`${FOUNDER_SESSION_COOKIE}=tok`);
    expect(secure).toContain("HttpOnly");
    expect(secure).toContain("SameSite=Strict");
    expect(secure).toContain("Path=/");
    expect(secure).toContain("Secure");
    expect(secure).toContain(`Max-Age=${EDITOR_SESSION_ABSOLUTE_LIFETIME_MS / 1000}`);
    expect(founderSessionCookie("tok", false)).not.toContain("Secure");
  });

  test("the CSRF cookie is browser-readable and the clears match scope", () => {
    const csrf = founderCsrfCookie("proof", true);
    expect(csrf).toContain(`${FOUNDER_CSRF_COOKIE}=proof`);
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("SameSite=Strict");
    expect(clearFounderSessionCookie(true)).toContain("Max-Age=0");
    expect(clearFounderSessionCookie(true)).toContain("HttpOnly");
    expect(clearFounderCsrfCookie(false)).toContain("Max-Age=0");
    expect(clearFounderCsrfCookie(false)).not.toContain("Secure");
  });
});
