// The single source of truth for which packages may appear in package.json.
// Both scripts/lint.mjs (the gate) and test/artifacts.test.mjs import this, so
// the rule and its test can never drift apart. See docs/decisions D020/D021.
//
// The docs tooling (scripts/, docs/dashboard/) must remain zero-dependency:
// it may import only node: builtins and each other. The application stack is
// the mission-approved set below.

export const APPROVED_DEPENDENCIES = Object.freeze({
  dependencies: Object.freeze([
    "@libsql/client",
    "@vercel/blob",
    "@xyflow/react",
    "drizzle-orm",
    "next",
    "react",
    "react-dom",
    "zod",
  ]),
  devDependencies: Object.freeze([
    "@axe-core/playwright",
    "@playwright/test",
    "@testing-library/jest-dom",
    "@testing-library/react",
    "@testing-library/user-event",
    "@types/node",
    "@types/react",
    "@types/react-dom",
    "drizzle-kit",
    "eslint",
    "jsdom",
    "typescript",
    "vitest",
  ]),
});

/** Exact pinned version, no range operators. */
export function isExactVersion(spec) {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(spec);
}

/**
 * Validates package.json against the approved set. Returns a list of problem
 * strings; an empty list means the dependency policy holds.
 */
export function dependencyProblems(pkg) {
  const problems = [];
  for (const field of ["dependencies", "devDependencies"]) {
    const declared = pkg[field] ?? {};
    const approved = new Set(APPROVED_DEPENDENCIES[field]);
    for (const [name, spec] of Object.entries(declared)) {
      if (!approved.has(name)) {
        problems.push(`package.json: ${field} contains unapproved package "${name}" (see scripts/lib/approved-deps.mjs)`);
      } else if (!isExactVersion(spec)) {
        problems.push(`package.json: ${field}.${name} must be an exact pinned version, found "${spec}"`);
      }
    }
  }
  const peer = Object.keys(pkg.peerDependencies ?? {});
  if (peer.length) {
    problems.push(`package.json: peerDependencies must stay empty, found ${peer.join(", ")}`);
  }
  return problems;
}
