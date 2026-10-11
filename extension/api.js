// Talking to Pinata (D132): signing in for a bearer token, the projects to
// send to, and one import per device. Every request goes from the extension's
// service worker or popup, which may reach the Pinata origin it was granted;
// the token rides in the Authorization header, never in a cookie. A response
// that renews the token carries the new one in its headers, and is stored.

import { EXTENSION_TOKEN_EXPIRES_HEADER, EXTENSION_TOKEN_HEADER } from "./shared.generated.js";
import { readSettings, writeSettings } from "./settings.js";

/** A Pinata answer the popup can explain. */
export class PinataError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(server, path, init = {}) {
  let response;
  try {
    response = await fetch(new URL(path, server), { cache: "no-store", ...init });
  } catch {
    throw new PinataError(0, null, `Pinata at ${new URL(server).host} could not be reached.`);
  }
  const renewed = response.headers.get(EXTENSION_TOKEN_HEADER);
  if (renewed) {
    await writeSettings({
      token: renewed,
      expiresAt: response.headers.get(EXTENSION_TOKEN_EXPIRES_HEADER) ?? null,
    });
  }
  return response;
}

async function failure(response, fallback) {
  let code = null;
  try {
    const body = await response.json();
    code = typeof body.code === "string" ? body.code : null;
  } catch {
    code = null;
  }
  if (response.status === 401) {
    return new PinataError(401, code, "Your Pinata sign-in has ended. Sign in again.");
  }
  if (response.status === 429) {
    return new PinataError(429, code, "Too many attempts. Wait a few minutes and try again.");
  }
  return new PinataError(response.status, code, fallback);
}

const authorized = (token, headers = {}) => ({ ...headers, authorization: `Bearer ${token}` });

/** Exchange the editor password for a token. */
export async function signIn(server, password) {
  const response = await request(server, "/api/extension/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (response.status === 401) throw new PinataError(401, null, "That password didn't match.");
  if (!response.ok) throw await failure(response, "Pinata could not sign you in. Try again.");
  return response.json();
}

/** Forget the token on the server too (best effort). */
export async function signOut(server, token) {
  try {
    await request(server, "/api/extension/session", {
      method: "DELETE",
      headers: authorized(token),
    });
  } catch {
    // Signing out locally is what matters; the token ends in 7 days anyway.
  }
}

/** The live projects and their pages. */
export async function listProjects() {
  const { server, token } = await readSettings();
  const response = await request(server, "/api/extension/projects", { headers: authorized(token) });
  if (!response.ok) throw await failure(response, "Pinata could not list your projects.");
  return (await response.json()).projects;
}

const IMPORT_MESSAGES = {
  "invalid-image": "Pinata didn't accept the screenshot.",
  "image-too-large": "The screenshot is too large to upload.",
  "document-too-tall": "This page is too tall for one capture.",
  "too-many-pixels": "This page is too large for one capture.",
  "invalid-url": "Pinata can't use this page's address.",
  "too-many-pages": "That project has the most pages it can hold.",
  "too-many-captures": "That project has used up its screenshots.",
};

/** Upload one device; resolves to Pinata's import result. */
export async function importShot(meta, image) {
  const { server, token } = await readSettings();
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("image", image, image.type === "image/png" ? "capture.png" : "capture.webp");
  const response = await request(server, "/api/imports", {
    method: "POST",
    headers: authorized(token),
    body: form,
  });
  if (response.ok) return response.json();
  const error = await failure(response, "Pinata could not take the capture.");
  if (error.code && IMPORT_MESSAGES[error.code]) error.message = IMPORT_MESSAGES[error.code];
  if (response.status === 404) error.message = "That project is gone or archived.";
  throw error;
}
