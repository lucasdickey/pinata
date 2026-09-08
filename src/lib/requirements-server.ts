// Server-only helpers for the /reqs pages: read the authoritative Markdown
// sources at build time and expose the deployed revision cue. Never import
// this from a client component.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadRequirementsDocument(sourcePath: string): string {
  // Keep the docs/ prefix as a static literal so the bundler traces only the
  // docs folder, not the whole project.
  const file = sourcePath.replace(/^docs\//, "");
  if (file === sourcePath || file.includes("..") || file.startsWith("/")) {
    throw new Error(`loadRequirementsDocument: expected a docs/ path, got ${sourcePath}`);
  }
  return readFileSync(join(process.cwd(), "docs", file), "utf8");
}

/**
 * The concrete commit the deployment was built from, when the platform
 * provides one (Vercel sets VERCEL_GIT_COMMIT_SHA). "local" marks a local
 * build; it is never presented as a deployment identity.
 */
export function deployedRevision(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
}
