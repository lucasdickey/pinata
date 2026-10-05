// GET/HEAD /a/[token]/captures/[captureId] — one screenshot for the agent
// brief (D121).
//
// The token must open a live project and the capture must belong to that
// project; anything else is the same plain 404, so a token never reveals
// another project's captures. Bytes go through the same delivery boundary
// as the editor's asset route (exact, revalidated, range-aware), and the
// agent link's no-cache, no-index, no-referrer rules apply to every answer.

import {
  projectOwnsCapture,
  resolveAgentToken,
} from "../../../../../src/lib/server/agent/link";
import {
  agentMethodNotAllowed,
  agentNotFound,
  agentUnavailable,
  withAgentSafety,
} from "../../../../../src/lib/server/agent/respond";
import { deliverCaptureAsset } from "../../../../../src/lib/server/captures/asset";
import { getScreenshotStore } from "../../../../../src/lib/server/captures/deps";
import { getDatabase } from "../../../../../src/lib/server/db/client";

interface RouteContext {
  params: Promise<{ token: string; captureId: string }>;
}

async function handle(
  request: Request,
  context: RouteContext,
  method: "GET" | "HEAD",
): Promise<Response> {
  const db = getDatabase();
  if (!db) return agentUnavailable();
  const { token, captureId } = await context.params;
  try {
    const grant = await resolveAgentToken(db, token);
    if (!grant) return agentNotFound();
    if (!(await projectOwnsCapture(db, grant.projectId, captureId))) return agentNotFound();
    const response = await deliverCaptureAsset(db, getScreenshotStore(), captureId, {
      method,
      range: request.headers.get("range"),
      ifNoneMatch: request.headers.get("if-none-match"),
      ifModifiedSince: request.headers.get("if-modified-since"),
    });
    // The delivery boundary's own denial is JSON; the agent link answers in
    // one plain form.
    if (response.status === 404) return agentNotFound();
    return withAgentSafety(response);
  } catch {
    return agentUnavailable();
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context, "GET");
}

export async function HEAD(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context, "HEAD");
}

export const POST = agentMethodNotAllowed;
export const PUT = agentMethodNotAllowed;
export const PATCH = agentMethodNotAllowed;
export const DELETE = agentMethodNotAllowed;
