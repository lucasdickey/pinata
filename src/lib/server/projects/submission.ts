// Project submission validation: turn one required root URL plus an optional
// explicit URL array into the ordered, deduplicated page set a project
// transaction can write, or into the complete list of per-row corrections
// (VAL-PROJECT-001, VAL-PROJECT-002, VAL-PROJECT-006).
//
// Pinata never crawls: the submitted rows are the only pages that can exist.
// Every row is reported, so one bad row never hides another.

import { createHash } from "node:crypto";
import {
  MAX_SUBMITTED_URL_ROWS,
  MAX_UNIQUE_PAGE_URLS,
  PROJECT_TITLE_MAX_CHARS,
} from "../../boundaries";
import { normalizeProjectUrl } from "../../url/normalize";

/** Which control an error belongs to; `form` errors are not row-scoped. */
export type ProjectErrorField = "rootUrl" | "urls" | "title" | "form";

export interface ProjectRowError {
  field: ProjectErrorField;
  /** Index within the explicit URL array, or null for non-row errors. */
  index: number | null;
  /** Bounded code from the URL reject reasons plus the limit codes below. */
  code: string;
}

export interface ProjectPageInput {
  requestedUrl: string;
  normalizedUrl: string;
  sortIndex: number;
}

export interface ProjectSubmissionInput {
  title?: string | undefined;
  rootUrl: string;
  urls?: readonly string[] | undefined;
}

export type ProjectSubmission =
  | {
      ok: true;
      title: string;
      rootUrl: string;
      pages: ProjectPageInput[];
      /** SHA-256 of the canonical normalized payload, for idempotency. */
      payloadDigest: string;
    }
  | { ok: false; errors: ProjectRowError[] };

/** Limit codes that are not URL reject reasons. */
export const PROJECT_LIMIT_CODES = ["too-many-rows", "too-many-pages", "too-long"] as const;

function canonicalDigest(title: string, normalizedUrls: readonly string[]): string {
  // Only normalized identities and the title decide the digest: retrying the
  // same intent with `#fragment` noise or a duplicate row still matches.
  return createHash("sha256")
    .update(JSON.stringify({ title, urls: normalizedUrls }))
    .digest("hex");
}

/** Default project title: the root host, which is always safe to display. */
function defaultTitle(normalizedRoot: string): string {
  return new URL(normalizedRoot).hostname;
}

/**
 * Validate and normalize a submission. On success the root is page 0 and the
 * explicit rows keep their first-seen order; duplicates of an earlier
 * identity (including the root) are dropped rather than rejected.
 */
export function validateProjectSubmission(input: ProjectSubmissionInput): ProjectSubmission {
  const errors: ProjectRowError[] = [];
  const rawTitle = (input.title ?? "").trim();
  if (rawTitle.length > PROJECT_TITLE_MAX_CHARS) {
    errors.push({ field: "title", index: null, code: "too-long" });
  }

  const rows = input.urls ?? [];
  // The row cap is checked before normalization so an oversized submission
  // never does per-row work.
  if (1 + rows.length > MAX_SUBMITTED_URL_ROWS) {
    errors.push({ field: "form", index: null, code: "too-many-rows" });
    return { ok: false, errors };
  }

  const root = normalizeProjectUrl(input.rootUrl ?? "");
  if (!root.ok) errors.push({ field: "rootUrl", index: null, code: root.reason });

  const ordered: ProjectPageInput[] = [];
  const seen = new Set<string>();
  const push = (requestedUrl: string, normalizedUrl: string) => {
    if (seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    ordered.push({ requestedUrl, normalizedUrl, sortIndex: ordered.length });
  };
  if (root.ok) push(input.rootUrl.trim(), root.url);

  rows.forEach((raw, index) => {
    // Blank optional rows are ignored (BLANK_URL_ROW_POLICY); only the root
    // may fail as blank.
    if (raw.trim() === "") return;
    const result = normalizeProjectUrl(raw);
    if (!result.ok) {
      errors.push({ field: "urls", index, code: result.reason });
      return;
    }
    push(raw.trim(), result.url);
  });

  if (ordered.length > MAX_UNIQUE_PAGE_URLS) {
    errors.push({ field: "form", index: null, code: "too-many-pages" });
  }
  if (errors.length > 0) return { ok: false, errors };

  const normalizedUrls = ordered.map((page) => page.normalizedUrl);
  const title = rawTitle === "" ? defaultTitle(normalizedUrls[0]!) : rawTitle;
  return {
    ok: true,
    title,
    rootUrl: normalizedUrls[0]!,
    pages: ordered,
    payloadDigest: canonicalDigest(title, normalizedUrls),
  };
}
