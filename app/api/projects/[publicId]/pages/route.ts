// /api/projects/[publicId]/pages — add pages to an existing project (D129).
//
// POST takes the URL rows a project was missing and commits them the way
// creation commits its pages: same-origin Origin, session + CSRF, content
// type and hard byte cap, strict schema, URL admission with complete
// per-row corrections, then one all-or-nothing transaction. An address the
// project already has is skipped and reported by row index, never added
// twice. As at creation, no provider call is issued before the response:
// once the transaction has committed, the server continues on its own and
// drives the project's pending attempts (D076).

import { PROJECT_REQUEST_MAX_BYTES } from "../../../../../src/lib/boundaries";
import {
  appendEditorRenewal,
  type SessionRenewal,
} from "../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../src/lib/server/auth/guard";
import { getCaptureDriveDeps } from "../../../../../src/lib/server/captures/deps";
import { driveProject } from "../../../../../src/lib/server/captures/drive";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../../src/lib/server/http";
import { addPagesToProject } from "../../../../../src/lib/server/projects/add-pages";
import { addPagesBodySchema } from "../../../../../src/lib/server/projects/schemas";
import { validatePageAdditions } from "../../../../../src/lib/server/projects/submission";

// The new pages' attempts run after the response, inside this function's
// budget (see the dispatch route's note on the value).
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function withRenewal(response: Response, renewal: SessionRenewal | null, secure: boolean): Response {
  response.headers.set("cache-control", "no-store");
  return appendEditorRenewal(response, renewal, secure);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewal, secure);

  const body = await readBoundedJson(request, PROJECT_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return deny(status, ERRORS.invalidRequest);
  }
  const parsed = addPagesBodySchema.safeParse(body.value);
  if (!parsed.success) return deny(400, ERRORS.invalidRequest);

  const submission = validatePageAdditions(parsed.data.urls);
  if (!submission.ok) {
    // Every offending row at once, by index, with bounded codes only; the
    // submitted values are never echoed.
    return withRenewal(
      Response.json({ error: ERRORS.invalidRequest, errors: submission.errors }, { status: 422 }),
      auth.renewal,
      secure,
    );
  }

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let result;
  try {
    result = await addPagesToProject(db, publicId, submission.rows, parsed.data.idempotencyKey);
  } catch {
    // The transaction rolled back: no page or attempt was added.
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) {
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    if (result.error === "conflict") return deny(409, ERRORS.rejected);
    return withRenewal(
      Response.json({ error: ERRORS.invalidRequest, errors: result.errors }, { status: 422 }),
      auth.renewal,
      secure,
    );
  }

  // Committed (or replayed): drive whatever the project has pending, so a
  // replay picks up an attempt that is still waiting rather than leaving it.
  if (result.result.added.length > 0) {
    const drive = getCaptureDriveDeps();
    const projectId = result.projectId;
    drive.after(async () => {
      await driveProject(db, projectId, drive);
    });
  }

  return withRenewal(
    Response.json(result.result, { status: result.created ? 201 : 200 }),
    auth.renewal,
    secure,
  );
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
