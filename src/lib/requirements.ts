// Shared constants for the /reqs hub. This module is dependency-free and
// safe to import from client components (the nav) — file loading lives in
// requirements-server.ts. Tests import these same constants so route tables,
// sources, and the dogfood URL array can never drift apart.

export interface RequirementsRoute {
  route: string;
  title: string;
  sourcePath: string;
  summary: string;
}

export const DECISIONS_SOURCE_PATH = "docs/decisions/decisions.json";

export const REQUIREMENTS_NAV: readonly RequirementsRoute[] = Object.freeze([
  {
    route: "/reqs",
    title: "Requirements",
    sourcePath: "docs/REQUIREMENTS.md",
    summary: "The problem, the naming story, scope, and non-goals.",
  },
  {
    route: "/reqs/architecture",
    title: "Architecture",
    sourcePath: "docs/ARCHITECTURE.md",
    summary: "System shape, stack, capture pipeline, and security boundaries.",
  },
  {
    route: "/reqs/milestones",
    title: "Milestones",
    sourcePath: "docs/MILESTONES.md",
    summary: "The three vertical slices and where the build stands.",
  },
  {
    route: "/reqs/decisions",
    title: "Decisions",
    sourcePath: DECISIONS_SOURCE_PATH,
    summary: "Every material decision, rendered from the single JSON source of truth.",
  },
  {
    route: "/reqs/evals",
    title: "Evals",
    sourcePath: "docs/EVALS.md",
    summary: "The human-readable catalog of evaluation scenarios.",
  },
]);

/** The four Markdown-backed routes, in hub order. */
export const REQUIREMENTS_SOURCES: readonly RequirementsRoute[] = Object.freeze(
  REQUIREMENTS_NAV.filter((r) => r.sourcePath.endsWith(".md")),
);

/**
 * The ordered URL array Pinata captures as its own dogfood project. Order is
 * contractual (VAL-REQS-005); pages must render it from this constant.
 */
export const DOGFOOD_URLS: readonly string[] = Object.freeze(
  REQUIREMENTS_NAV.map((r) => r.route),
);
