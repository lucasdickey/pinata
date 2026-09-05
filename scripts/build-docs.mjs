#!/usr/bin/env node
// Generates docs/DECISIONS.md and docs/dashboard/decisions-data.js from
// docs/decisions/decisions.json. See AGENTS.md sections 2 and 3.
//
//   node scripts/build-docs.mjs            write the generated artifacts
//   node scripts/build-docs.mjs --check    verify they are current, write nothing
//
// Zero dependencies on purpose: the artifacts have to survive without an install
// step, and the dashboard has to open over file:// without a server.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown, renderDataIsland, validate, screenshotPaths } from "./lib/decisions.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = join(ROOT, "docs/decisions/decisions.json");
export const MD_OUT = join(ROOT, "docs/DECISIONS.md");
export const JS_OUT = join(ROOT, "docs/dashboard/decisions-data.js");
export const SHOT_DIR = join(ROOT, "docs/dashboard");

/** Reads and validates the source, and confirms referenced screenshots exist. */
export function loadSource() {
  const raw = readFileSync(SOURCE, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`decisions.json is not valid JSON: ${err.message}`);
  }

  const errors = validate(data);
  for (const p of screenshotPaths(data)) {
    if (!existsSync(join(SHOT_DIR, p))) {
      errors.push(`screenshot referenced but missing on disk: docs/dashboard/${p}`);
    }
  }
  if (errors.length) {
    throw new Error(`decisions.json failed validation:\n  - ${errors.join("\n  - ")}`);
  }

  const sourceHash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return { data, sourceHash };
}

/** The expected content of every generated artifact, keyed by absolute path. */
export function renderAll() {
  const { data, sourceHash } = loadSource();
  return {
    data,
    sourceHash,
    files: {
      [MD_OUT]: renderMarkdown(data, { sourceHash }),
      [JS_OUT]: renderDataIsland(data, { sourceHash }),
    },
  };
}

function main(argv) {
  const check = argv.includes("--check");
  const rel = (p) => relative(ROOT, p);

  let rendered;
  try {
    rendered = renderAll();
  } catch (err) {
    console.error(`\n[build-docs] ${err.message}\n`);
    return 1;
  }

  const { data, sourceHash, files } = rendered;

  if (check) {
    const stale = Object.entries(files).filter(([path, expected]) => {
      const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
      return actual !== expected;
    });
    if (stale.length) {
      console.error(
        `\n[build-docs] generated docs are stale:\n  - ${stale
          .map(([p]) => rel(p))
          .join("\n  - ")}\n\nRun \`npm run docs\` and commit the result.\n`,
      );
      return 1;
    }
    console.log(`[build-docs] generated docs are current (${data.decisions.length} decisions, source ${sourceHash})`);
    return 0;
  }

  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
    console.log(`[build-docs] wrote ${rel(path)}`);
  }
  console.log(`[build-docs] ${data.decisions.length} decision(s) OK, source ${sourceHash}`);
  return 0;
}

// Only act when run as a CLI, so the module stays importable from tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
