// /api/captures/[captureId]/annotations/[annotationId]/thread — the
// append-only two-way thread under one pin (REQUIREMENTS 6, VAL-THREAD-001,
// VAL-THREAD-003, VAL-THREAD-004, VAL-THREAD-006).
//
// GET lists the entries in their one documented order for either role: the
// editor session, or a founder session whose capability binds to this
// capture's project. POST appends exactly one entry: the editor follows up
// as `editor`/`Lucas`; a founder replies as `founder`/`founder`, subject to
// the durable per-project reply quota. Labels are assigned server-side,
// never taken from the request. Nothing in this route — or anywhere else —
// ever updates or deletes an entry; the database triggers guarantee it.
//
// Boundary order for POST: same-origin Origin, session + CSRF for whichever
// role the cookies prove, content type and hard byte cap, strict schema,
// then the durable idempotent append. A tombstoned pin, a pin of another
// capture, a foreign project, and a rotated or revoked capability all end
// in the same generic 404/401 shapes the rest of the API uses.

import { ANNOTATION_REQUEST_MAX_BYTES } from "../../../../../../../src/lib/boundaries";
import { getDatabase } from "../../../../../../../src/lib/server/db/client";
import {
  authorizeCaptureReader,
  authorizeCaptureReplier,
  type CaptureActor,
} from "../../../../../../../src/lib/server/founder/reader";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../../../../src/lib/server/http";
import {
  appendThreadEntry,
  listThreadEntries,
  type ThreadAdmission,
} from "../../../../../../../src/lib/server/threads/entries";
import { appendThreadEntryBodySchema } from "../../../../../../../src/lib/server/threads/schemas";
import {
  checkReplyThrottle,
  registerReply,
} from "../../../../../../../src/lib/server/threads/throttle";

interface RouteContext {
  params: Promise<{ captureId: string; annotationId: string }>;
}

function finish(response: Response, actor: CaptureActor | null): Response {
  response.headers.set("cache-control", "no-store");
  if (actor?.renewCookie) response.headers.append("set-cookie", actor.renewCookie);
  return response;
}

/** List the thread under one live pin, oldest first. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const secure = isSecureRequest(request);
  const db = getDatabase();
  const { captureId, annotationId } = await context.params;
  const auth = await authorizeCaptureReader(request, db, captureId, secure);
  if (!auth.ok) return finish(auth.response, null);
  if (!db) return finish(jsonError(503, ERRORS.unavailable), auth.actor);

  let result;
  try {
    result = await listThreadEntries(db, { captureId, annotationId });
  } catch {
    return finish(jsonError(503, ERRORS.unavailable), auth.actor);
  }
  if (!result.ok) return finish(jsonError(404, ERRORS.rejected), auth.actor);
  return finish(Response.json({ entries: result.entries }), auth.actor);
}

/** Bounded generic 429 with the standard retry guidance header. */
function throttledResponse(retryAfterMs: number): Response {
  const response = jsonError(429, ERRORS.throttled);
  response.headers.set("retry-after", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return response;
}

/** Append one bounded reply or follow-up; the label follows the role. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);
  const secure = isSecureRequest(request);
  const db = getDatabase();
  const { captureId, annotationId } = await context.params;
  const auth = await authorizeCaptureReplier(request, db, captureId, secure);
  if (!auth.ok) return finish(auth.response, null);
  const actor = auth.actor;
  const deny = (status: number, message: string) => finish(jsonError(status, message), actor);
  if (!db) return deny(503, ERRORS.unavailable);

  const body = await readBoundedJson(request, ANNOTATION_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return deny(status, ERRORS.invalidRequest);
  }
  const parsed = appendThreadEntryBodySchema.safeParse(body.value);
  if (!parsed.success) return deny(400, ERRORS.invalidRequest);

  // Founder replies are quota-bound per project in the durable store; the
  // store consults this only for a genuinely new, valid reply (a replayed
  // key never consumes quota). The editor's follow-ups carry no quota.
  const projectId = actor.projectId;
  const admission: ThreadAdmission | undefined =
    actor.role === "founder" && projectId
      ? async () => {
          const state = await checkReplyThrottle(db, projectId, Date.now());
          if (state.throttled) return { ok: false, retryAfterMs: state.retryAfterMs };
          const registered = await registerReply(db, projectId, Date.now());
          if (registered.throttled) return { ok: false, retryAfterMs: registered.retryAfterMs };
          return { ok: true };
        }
      : undefined;

  let result;
  try {
    result = await appendThreadEntry(
      db,
      {
        captureId,
        annotationId,
        actorRole: actor.role,
        body: parsed.data.body,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      undefined,
      admission,
    );
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) {
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    if (result.error === "invalid") return deny(400, ERRORS.invalidRequest);
    if (result.error === "throttled") return finish(throttledResponse(result.retryAfterMs), actor);
    return deny(409, ERRORS.rejected);
  }
  return finish(
    Response.json({ entry: result.entry }, { status: result.created ? 201 : 200 }),
    actor,
  );
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
