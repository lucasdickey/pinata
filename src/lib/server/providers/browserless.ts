// Server-only Browserless provider boundary. The dependency-injectable client
// lets focused tests drive deterministic provider outcomes (success, auth
// failure, provider failure, timeout, oversized response) without network
// access. Mocks may prove adapter behavior and failure handling; they never
// substitute for the real Browserless end-to-end checks that own the capture
// assertions.
//
// Invariants (architecture.md section 7):
// - one fixed regional Function endpoint; the token goes in the Authorization
//   header, never the URL;
// - user input is context data, never interpolated into executed code;
// - responses are bounded by MAX_PROVIDER_RESPONSE_BYTES before use;
// - failures map to bounded, secret-free error codes — provider bodies and
//   credentials never leak into results, logs, or responses.

import { MAX_PROVIDER_RESPONSE_BYTES } from "../../boundaries";

/** Fixed Browserless regional Function API endpoint (SFO). */
export const BROWSERLESS_FUNCTION_ENDPOINT = "https://production-sfo.browserless.io/function";

export interface BrowserlessRunRequest {
  /**
   * ESM function source executed by the provider
   * (`export default async ({ page, context }) => ...`). Built by the
   * capture pipeline; user input travels in `context`, never in this code.
   */
  code: string;
  /** JSON-serializable context passed to the function. */
  context: Record<string, unknown>;
  /** Whole-call deadline, at or under TOTAL_CAPTURE_TIMEOUT_MS. */
  timeoutMs: number;
}

export type BrowserlessRunError = "unavailable" | "rejected" | "too-large" | "timeout";

export type BrowserlessRunResult =
  | { ok: true; status: number; body: Uint8Array }
  | { ok: false; error: BrowserlessRunError };

export interface BrowserlessClient {
  runFunction(request: BrowserlessRunRequest): Promise<BrowserlessRunResult>;
}

export interface BrowserlessEnv {
  BROWSERLESS_TOKEN?: string | undefined;
  [key: string]: string | undefined;
}

/** Minimal fetch seam so tests can inject deterministic provider outcomes. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; body: Uint8Array }>;

async function defaultFetch(
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
): Promise<{ status: number; body: Uint8Array }> {
  const response = await fetch(input, init);
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
}

/**
 * Build the real Browserless client from environment configuration, with an
 * injectable fetch for focused fault tests. Fails closed (null) when the
 * token is absent; never logs the token or provider response bodies.
 */
export function createBrowserlessClient(
  env: BrowserlessEnv,
  fetchImpl: FetchLike = defaultFetch,
): BrowserlessClient | null {
  const token = env.BROWSERLESS_TOKEN;
  if (!token) return null;
  return {
    async runFunction(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetchImpl(BROWSERLESS_FUNCTION_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: request.code, context: request.context }),
          signal: controller.signal,
        });
        if (response.body.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
          return { ok: false, error: "too-large" };
        }
        if (response.status === 401 || response.status === 403) {
          return { ok: false, error: "rejected" };
        }
        if (response.status < 200 || response.status >= 300) {
          return { ok: false, error: "unavailable" };
        }
        return { ok: true, status: response.status, body: response.body };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return { ok: false, error: "timeout" };
        }
        return { ok: false, error: "unavailable" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
