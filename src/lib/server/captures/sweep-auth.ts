// Shared-secret authorization for the capture sweep route (D076).
//
// The sweep is called by machines: Vercel cron sends
// `Authorization: Bearer $CRON_SECRET`; any other scheduler, or an operator
// by hand, sends the sweep secret in its own header. Both compare in
// constant time, and when neither variable is set the route does not exist
// as far as a caller can tell (404). Nothing here reads a request body.

import { timingSafeEqual } from "node:crypto";

/** Header a scheduler outside Vercel cron sends CAPTURE_SWEEP_SECRET in. */
export const SWEEP_SECRET_HEADER = "x-pinata-sweep-secret";

export type SweepAuthorization = "unconfigured" | "denied" | "allowed";

export interface SweepEnv {
  CAPTURE_SWEEP_SECRET?: string | undefined;
  CRON_SECRET?: string | undefined;
  [key: string]: string | undefined;
}

function secretsMatch(presented: string | null, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Decide whether this request may run the sweep. */
export function authorizeSweep(request: Request, env: SweepEnv): SweepAuthorization {
  const sweepSecret = env.CAPTURE_SWEEP_SECRET || undefined;
  const cronSecret = env.CRON_SECRET || undefined;
  if (!sweepSecret && !cronSecret) return "unconfigured";
  if (secretsMatch(request.headers.get(SWEEP_SECRET_HEADER), sweepSecret)) return "allowed";
  if (secretsMatch(bearerToken(request), cronSecret)) return "allowed";
  return "denied";
}
