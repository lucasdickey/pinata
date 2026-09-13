// /api/projects — the editor's project collection.
//
// POST creates one project atomically from a required public HTTPS root plus
// an optional explicit URL array (VAL-PROJECT-001, VAL-PROJECT-002,
// VAL-PROJECT-006). Boundary order: same-origin Origin, session + CSRF,
// content type and hard byte cap, strict schema, URL admission with complete
// per-row corrections, then one all-or-nothing transaction. Pinata never
// crawls, so no discovery step exists anywhere in this path, and no provider
// call is issued before the response: once the transaction has committed and
// the response is written, the server continues on its own and drives the
// new project's pending attempts (D076), so nothing depends on the browser
// staying open.
//
// GET lists the committed hierarchy from the durable store.

import { PROJECT_REQUEST_MAX_BYTES } from "../../../src/lib/boundaries";
import { sessionCookie } from "../../../src/lib/server/auth/cookies";
import { requireEditor, requireEditorMutation } from "../../../src/lib/server/auth/guard";
import { getCaptureDriveDeps } from "../../../src/lib/server/captures/deps";
import { driveProject } from "../../../src/lib/server/captures/drive";
import { getDatabase } from "../../../src/lib/server/db/client";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../src/lib/server/http";
import { createProjectAtomically } from "../../../src/lib/server/projects/create";
import { listProjectHierarchies } from "../../../src/lib/server/projects/hierarchy";
import { createProjectBodySchema } from "../../../src/lib/server/projects/schemas";
import { validateProjectSubmission } from "../../../src/lib/server/projects/submission";

// Project creation commits pending attempts and the continuation below runs
// them after the response, inside this function's budget (see the dispatch
// route's note on the value).
export const maxDuration = 300;

/** Attach a renewed session cookie when the guard issued one. */
function withRenewal(response: Response, renewedToken: string | null, secure: boolean): Response {
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);

  const body = await readBoundedJson(request, PROJECT_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return withRenewal(jsonError(status, ERRORS.invalidRequest), auth.renewedToken, secure);
  }
  const parsed = createProjectBodySchema.safeParse(body.value);
  if (!parsed.success) {
    return withRenewal(jsonError(400, ERRORS.invalidRequest), auth.renewedToken, secure);
  }

  const submission = validateProjectSubmission({
    title: parsed.data.title,
    rootUrl: parsed.data.rootUrl,
    urls: parsed.data.urls,
  });
  if (!submission.ok) {
    // Every offending row is reported at once, by field and index, using
    // bounded codes only — the submitted values are never echoed.
    const response = Response.json(
      { error: ERRORS.invalidRequest, errors: submission.errors },
      { status: 422 },
    );
    return withRenewal(response, auth.renewedToken, secure);
  }

  const db = getDatabase();
  if (!db) return withRenewal(jsonError(503, ERRORS.unavailable), auth.renewedToken, secure);

  let result;
  try {
    result = await createProjectAtomically(db, submission, parsed.data.idempotencyKey);
  } catch {
    // The transaction rolled back: no project, page, or attempt exists.
    return withRenewal(jsonError(503, ERRORS.unavailable), auth.renewedToken, secure);
  }
  if (!result.ok) {
    return withRenewal(jsonError(409, ERRORS.rejected), auth.renewedToken, secure);
  }

  // The rows are committed; capture continues after the response is written,
  // and the project chains to completion from there. A replayed key drives
  // too: whatever is still pending is picked up rather than left waiting.
  const drive = getCaptureDriveDeps();
  const projectId = result.project.projectId;
  drive.after(async () => {
    await driveProject(db, projectId, drive);
  });

  const response = Response.json(
    { project: result.project },
    { status: result.created ? 201 : 200 },
  );
  return withRenewal(response, auth.renewedToken, secure);
}

export async function GET(request: Request): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;
  const db = getDatabase();
  if (!db) {
    return withRenewal(
      jsonError(503, ERRORS.unavailable),
      auth.renewedToken,
      isSecureRequest(request),
    );
  }
  try {
    const projects = await listProjectHierarchies(db, Date.now());
    return withRenewal(
      Response.json({ projects }),
      auth.renewedToken,
      isSecureRequest(request),
    );
  } catch {
    return withRenewal(
      jsonError(503, ERRORS.unavailable),
      auth.renewedToken,
      isSecureRequest(request),
    );
  }
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
