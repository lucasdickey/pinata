// /api/captures/sweep — re-drive every project with pending or stale capture
// work (D076). This is the backstop behind server continuation: a chain that
// died mid-way (a function that hit its duration limit, a process that went
// away) is picked up here, and a stale attempt gets its one automatic retry.
//
// The route is for machines, not people: no editor session, no same-origin
// rule. It is protected by a shared secret instead, sent either as the
// `x-pinata-sweep-secret` header (CAPTURE_SWEEP_SECRET) or, because Vercel
// cron sends `Authorization: Bearer $CRON_SECRET`, as that bearer credential
// (CRON_SECRET). With neither variable set the route answers 404, so an
// unconfigured deployment has no sweep surface at all. The answer carries
// counts only: never a URL, an attempt id, or a secret.

import { getCaptureDriveDeps } from "../../../../src/lib/server/captures/deps";
import { sweepCaptures } from "../../../../src/lib/server/captures/drive";
import { authorizeSweep } from "../../../../src/lib/server/captures/sweep-auth";
import { getDatabase } from "../../../../src/lib/server/db/client";
import { ERRORS, jsonError } from "../../../../src/lib/server/http";

// The sweep schedules capture work that runs after this response, inside the
// same function budget as the dispatch route (see that module's note).
export const maxDuration = 300;

async function sweep(request: Request): Promise<Response> {
  const auth = authorizeSweep(request, process.env);
  if (auth === "unconfigured") return jsonError(404, ERRORS.rejected);
  if (auth === "denied") return jsonError(401, ERRORS.authRequired);

  const db = getDatabase();
  if (!db) return jsonError(503, ERRORS.unavailable);

  try {
    const report = await sweepCaptures(db, getCaptureDriveDeps());
    return Response.json({ sweep: report }, { status: 200 });
  } catch {
    return jsonError(503, ERRORS.unavailable);
  }
}

// Vercel cron calls with GET; a hand-run or third-party scheduler POSTs.
export const GET = sweep;
export const POST = sweep;

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
