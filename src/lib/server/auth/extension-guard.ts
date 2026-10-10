// Authorization for the Chrome extension's routes (D132), and for the one
// route both the editor's page and the extension write to: importing a
// capture (D131).
//
// The extension authenticates with a bearer token, so its requests carry no
// cookie, no CSRF proof, and an Origin of chrome-extension://…; none of
// that is needed, because a browser never attaches an Authorization header
// on its own. A request without one is held to the editor's full mutation
// boundary instead: same origin, session, and CSRF proof.

import {
  EXTENSION_TOKEN_EXPIRES_HEADER,
  EXTENSION_TOKEN_HEADER,
} from "../../auth-constants";
import { ERRORS, hasSameOrigin, isSecureRequest, jsonError } from "../http";
import { isAuthDisabled } from "./bypass";
import { appendEditorRenewal, type SessionRenewal } from "./cookies";
import {
  bearerToken,
  renewExtensionToken,
  verifyExtensionToken,
  type ExtensionTokenPayload,
} from "./extension-token";
import { requireEditorMutation } from "./guard";
import { getSessionSecret } from "./secrets";

/** A renewed extension token and its new absolute expiry. */
export interface ExtensionRenewal {
  token: string;
  exp: number;
}

export type ExtensionAuthResult =
  | { ok: true; payload: ExtensionTokenPayload | null; renewal: ExtensionRenewal | null }
  | { ok: false; response: Response };

/**
 * Authorize an extension request by its bearer token. Missing, forged,
 * expired, and signed-out tokens all get the same 401. Under the local-only
 * bypass (PINATA_AUTH_DISABLED=1, D052) every request is the editor, as it
 * is for the editor's own routes.
 */
export function requireExtension(request: Request): ExtensionAuthResult {
  if (isAuthDisabled()) return { ok: true, payload: null, renewal: null };
  const secret = getSessionSecret();
  if (!secret) return { ok: false, response: jsonError(503, ERRORS.unavailable) };
  const token = bearerToken(request);
  if (!token) return { ok: false, response: jsonError(401, ERRORS.authRequired) };
  const now = Date.now();
  const result = verifyExtensionToken(token, secret, now);
  if (result.status !== "valid") {
    return { ok: false, response: jsonError(401, ERRORS.authRequired) };
  }
  const renewal = result.renew ? renewExtensionToken(result.payload, secret, now) : null;
  return {
    ok: true,
    payload: result.payload,
    renewal: renewal ? { token: renewal.token, exp: renewal.payload.exp } : null,
  };
}

/** Attach a renewed extension token to a response, when there is one. */
export function appendExtensionRenewal(
  response: Response,
  renewal: ExtensionRenewal | null,
): Response {
  if (!renewal) return response;
  response.headers.set(EXTENSION_TOKEN_HEADER, renewal.token);
  response.headers.set(EXTENSION_TOKEN_EXPIRES_HEADER, new Date(renewal.exp).toISOString());
  return response;
}

/** Who is importing: the editor's page, or the extension. */
export type ImportAuthResult =
  | {
      ok: true;
      actor: "editor" | "extension";
      /** Attach whatever renewal this actor's credential earned. */
      finish: (response: Response) => Response;
    }
  | { ok: false; response: Response };

/**
 * Authorize a capture import. A request that names a bearer token is the
 * extension's and stands or falls on that token alone; every other request
 * is the editor's page and must pass the editor's mutation boundary.
 */
export function requireImportAuthority(request: Request): ImportAuthResult {
  if (request.headers.has("authorization")) {
    const auth = requireExtension(request);
    if (!auth.ok) return auth;
    return {
      ok: true,
      actor: "extension",
      finish: (response) => appendExtensionRenewal(response, auth.renewal),
    };
  }
  if (!hasSameOrigin(request)) return { ok: false, response: jsonError(403, ERRORS.rejected) };
  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth;
  const secure = isSecureRequest(request);
  const renewal: SessionRenewal | null = auth.renewal;
  return {
    ok: true,
    actor: "editor",
    finish: (response) => appendEditorRenewal(response, renewal, secure),
  };
}
