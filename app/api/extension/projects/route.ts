// GET /api/extension/projects — the projects the Chrome extension can send a
// capture to (D132): every live project in the editor's list, newest first,
// with its pages, so the extension can tell whether the open tab is already
// one of them. Only identifiers and addresses; no capture data, no counts.

import { and, asc, desc, inArray, isNull } from "drizzle-orm";
import {
  appendExtensionRenewal,
  requireExtension,
} from "../../../../src/lib/server/auth/extension-guard";
import { getDatabase, schema } from "../../../../src/lib/server/db/client";
import { ERRORS, jsonError } from "../../../../src/lib/server/http";

export interface ExtensionProjectList {
  projects: {
    publicId: string;
    title: string;
    rootUrl: string;
    pages: { id: string; normalizedUrl: string }[];
  }[];
}

export async function GET(request: Request): Promise<Response> {
  const auth = requireExtension(request);
  if (!auth.ok) return auth.response;
  const finish = (response: Response) => {
    response.headers.set("cache-control", "no-store");
    return appendExtensionRenewal(response, auth.renewal);
  };

  const db = getDatabase();
  if (!db) return finish(jsonError(503, ERRORS.unavailable));

  let list: ExtensionProjectList;
  try {
    const projects = await db
      .select({
        id: schema.projects.id,
        publicId: schema.projects.publicId,
        title: schema.projects.title,
        rootUrl: schema.projects.rootUrl,
      })
      .from(schema.projects)
      .where(and(isNull(schema.projects.deletedAt), isNull(schema.projects.archivedAt)))
      .orderBy(desc(schema.projects.createdAt), asc(schema.projects.id));
    const pages =
      projects.length === 0
        ? []
        : await db
            .select({
              id: schema.pages.id,
              projectId: schema.pages.projectId,
              normalizedUrl: schema.pages.normalizedUrl,
            })
            .from(schema.pages)
            .where(
              inArray(
                schema.pages.projectId,
                projects.map((project) => project.id),
              ),
            )
            .orderBy(asc(schema.pages.sortIndex), asc(schema.pages.id));
    list = {
      projects: projects.map((project) => ({
        publicId: project.publicId,
        title: project.title,
        rootUrl: project.rootUrl,
        pages: pages
          .filter((page) => page.projectId === project.id)
          .map((page) => ({ id: page.id, normalizedUrl: page.normalizedUrl })),
      })),
    };
  } catch {
    return finish(jsonError(503, ERRORS.unavailable));
  }
  return finish(Response.json(list));
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
