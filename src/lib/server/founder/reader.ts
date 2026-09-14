// The shared "editor or founder" authorization for capture-scoped reads and
// thread replies (VAL-CAPTURE-010, VAL-THREAD-001).
//
// The editor session is tried first, exactly as before founders existed. A
// founder cookie is consulted only when one is present, and a founder must
// own the capture's project; every founder failure answers with the
// editor's own denial, so anonymous, expired, tampered, foreign-project,
// rotated, and revoked callers are indistinguishable from each other and
// from what these routes always answered.

import { EDITOR_VIEWER, founderViewer, type Viewer } from "../annotations/seen";
import { sessionCookie } from "../auth/cookies";
import { requireEditor, requireEditorMutation } from "../auth/guard";
import type { Database } from "../db/client";
import type { ThreadActorRole } from "../db/schema";
import { ERRORS, jsonError } from "../http";
import { founderSessionCookie } from "./cookies";
import {
  hasFounderCookie,
  requireFounderForCapture,
  requireFounderMutationForCapture,
} from "./guard";

/** Whichever role the request proved, plus how to renew its cookie. */
export interface CaptureActor {
  role: ThreadActorRole;
  /** The founder's project id (the reply-quota scope); null for the editor. */
  projectId: string | null;
  /** The identity unread counts and last-seen marks are kept under (D075). */
  viewer: Viewer;
  /** A renewed session Set-Cookie value when inside the renewal threshold. */
  renewCookie: string | null;
}

export type CaptureActorResult =
  | { ok: true; actor: CaptureActor }
  | { ok: false; response: Response };

/** Authorize a read of one capture by the editor or by its founder. */
export async function authorizeCaptureReader(
  request: Request,
  db: Database | null,
  captureId: string,
  secure: boolean,
): Promise<CaptureActorResult> {
  const editor = requireEditor(request);
  if (editor.ok) {
    return {
      ok: true,
      actor: {
        role: "editor",
        projectId: null,
        viewer: EDITOR_VIEWER,
        renewCookie: editor.renewedToken ? sessionCookie(editor.renewedToken, secure) : null,
      },
    };
  }
  if (!hasFounderCookie(request)) return { ok: false, response: editor.response };
  // The founder binding is live authority and needs the durable store.
  if (!db) return { ok: false, response: jsonError(503, ERRORS.unavailable) };
  const founder = await requireFounderForCapture(request, db, captureId);
  if (!founder.ok) return { ok: false, response: editor.response };
  return {
    ok: true,
    actor: {
      role: "founder",
      projectId: founder.session.pid,
      viewer: founderViewer(founder.session.ver),
      renewCookie: founder.renewedToken
        ? founderSessionCookie(founder.renewedToken, secure)
        : null,
    },
  };
}

/** Authorize a capture-scoped mutation (a thread append) by either role. */
export async function authorizeCaptureReplier(
  request: Request,
  db: Database | null,
  captureId: string,
  secure: boolean,
): Promise<CaptureActorResult> {
  const editor = requireEditorMutation(request);
  if (editor.ok) {
    return {
      ok: true,
      actor: {
        role: "editor",
        projectId: null,
        viewer: EDITOR_VIEWER,
        renewCookie: editor.renewedToken ? sessionCookie(editor.renewedToken, secure) : null,
      },
    };
  }
  if (!hasFounderCookie(request)) return { ok: false, response: editor.response };
  if (!db) return { ok: false, response: jsonError(503, ERRORS.unavailable) };
  const founder = await requireFounderMutationForCapture(request, db, captureId);
  // A founder with a session but a missing/wrong CSRF proof gets the
  // founder guard's own 403, like the editor's mutation guard would.
  if (!founder.ok) return { ok: false, response: founder.response };
  return {
    ok: true,
    actor: {
      role: "founder",
      projectId: founder.session.pid,
      viewer: founderViewer(founder.session.ver),
      renewCookie: founder.renewedToken
        ? founderSessionCookie(founder.renewedToken, secure)
        : null,
    },
  };
}
