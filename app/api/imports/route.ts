// POST /api/imports — file one uploaded capture (D131).
//
// The editor's page and the Chrome extension both send here: the page with
// its session, CSRF proof, and same Origin; the extension with its bearer
// token (D132). One request carries one device of one page as
// multipart/form-data — a `meta` JSON part and an `image` part — and the
// body is capped while it is read, before anything is parsed. The meta is
// parsed strictly; the image and the element list are then held to the
// provider path's rules by importCapture, which stores the image privately
// and writes the ready attempt. Every refusal is a bounded code; nothing the
// request sent is echoed.

import { UPLOAD_REQUEST_MAX_BYTES } from "../../../src/lib/boundaries";
import { requireImportAuthority } from "../../../src/lib/server/auth/extension-guard";
import { getScreenshotStore } from "../../../src/lib/server/captures/deps";
import { getDatabase } from "../../../src/lib/server/db/client";
import { ERRORS, jsonError, readBoundedForm } from "../../../src/lib/server/http";
import { importCapture } from "../../../src/lib/server/imports/import";
import { importMetaSchema } from "../../../src/lib/server/imports/schemas";

/** The JSON part's own cap: an element list at its limit plus framing. */
const META_MAX_CHARS = 400_000;

export async function POST(request: Request): Promise<Response> {
  const auth = requireImportAuthority(request);
  if (!auth.ok) return auth.response;
  const reply = (response: Response) => {
    response.headers.set("cache-control", "no-store");
    return auth.finish(response);
  };
  const deny = (status: number, message: string) => reply(jsonError(status, message));

  const body = await readBoundedForm(request, UPLOAD_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return deny(status, ERRORS.invalidRequest);
  }
  const metaPart = body.form.get("meta");
  const imagePart = body.form.get("image");
  if (typeof metaPart !== "string" || metaPart.length > META_MAX_CHARS) {
    return deny(400, ERRORS.invalidRequest);
  }
  if (imagePart === null || typeof imagePart === "string") return deny(400, ERRORS.invalidRequest);

  let metaJson: unknown;
  try {
    metaJson = JSON.parse(metaPart);
  } catch {
    return deny(400, ERRORS.invalidRequest);
  }
  const meta = importMetaSchema.safeParse(metaJson);
  if (!meta.success) return deny(400, ERRORS.invalidRequest);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);
  const store = getScreenshotStore();
  if (!store) return deny(503, ERRORS.unavailable);

  let result;
  try {
    result = await importCapture(db, store, {
      meta: meta.data,
      image: {
        bytes: new Uint8Array(await imagePart.arrayBuffer()),
        contentType: imagePart.type,
      },
      actor: auth.actor,
    });
  } catch {
    return deny(503, ERRORS.unavailable);
  }

  if (!result.ok) {
    if (result.error === "refused") {
      return reply(
        Response.json({ error: ERRORS.invalidRequest, code: result.reason }, { status: 422 }),
      );
    }
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    if (result.error === "conflict") return deny(409, ERRORS.rejected);
    return deny(503, ERRORS.unavailable);
  }
  return reply(Response.json(result.result, { status: result.created ? 201 : 200 }));
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
