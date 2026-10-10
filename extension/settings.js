// What the extension remembers, in chrome.storage.local: which Pinata it
// talks to, its sign-in token and expiry, and the project each site's
// captures last went to. Nothing about captured pages is kept here.

/** The Pinata a fresh install talks to. */
export const DEFAULT_SERVER = "https://yourpinata.dev";

const DEFAULTS = {
  server: DEFAULT_SERVER,
  token: null,
  expiresAt: null,
  lastProjectByHost: {},
};

export async function readSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function writeSettings(patch) {
  await chrome.storage.local.set(patch);
}

/** The origin a typed Pinata address names, or null. */
export function serverOrigin(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** True while the stored token has not passed its expiry. */
export function signedIn(settings, now = Date.now()) {
  if (!settings.token) return false;
  if (!settings.expiresAt) return true;
  const expires = Date.parse(settings.expiresAt);
  return Number.isNaN(expires) || expires > now;
}
