// GET /a/[token] — the agent brief (D121): one project's open marks as
// Markdown, for a coding agent that has only this URL.
//
// No session and no key: the token in the path is the whole authority, and
// it only ever reads. Each screenshot is linked under the same token so the
// agent can download the images without signing in. An unknown, revoked,
// or malformed token is the same plain 404.

import { listProjectPins } from "../../../src/lib/server/annotations/project-pins";
import { resolveAgentToken } from "../../../src/lib/server/agent/link";
import {
  agentLinkPath,
  agentMethodNotAllowed,
  agentNotFound,
  agentUnavailable,
  withAgentSafety,
} from "../../../src/lib/server/agent/respond";
import { getDatabase } from "../../../src/lib/server/db/client";
import { formatAgentBrief } from "../../../src/lib/agent-brief";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const db = getDatabase();
  if (!db) return agentUnavailable();
  const { token } = await context.params;

  let brief: string;
  try {
    const grant = await resolveAgentToken(db, token);
    if (!grant) return agentNotFound();
    const now = Date.now();
    const listed = await listProjectPins(db, grant.publicId, now);
    if (!listed.ok) return agentNotFound();
    // The host the agent called, as hasSameOrigin reads it: the dev server
    // and some proxies rewrite request.url's host, never the Host header.
    const target = new URL(request.url);
    const host = request.headers.get("host") ?? target.host;
    const base = `${target.protocol}//${host}${agentLinkPath(token)}`;
    brief = formatAgentBrief(listed.annotations, {
      title: grant.title,
      rootUrl: grant.rootUrl,
      screenshotUrl: (captureId) => `${base}/captures/${encodeURIComponent(captureId)}`,
      generatedAt: now,
    });
  } catch {
    return agentUnavailable();
  }

  return withAgentSafety(
    new Response(`${brief}\n`, {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    }),
  );
}

export const POST = agentMethodNotAllowed;
export const PUT = agentMethodNotAllowed;
export const PATCH = agentMethodNotAllowed;
export const DELETE = agentMethodNotAllowed;
