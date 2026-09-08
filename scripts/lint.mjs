#!/usr/bin/env node
// Dependency-free lint: syntax-check every JS module, and enforce the
// repository rules that are easy to break by accident (dependencies stay
// within the approved set at exact versions, no hand-edits to generated
// files).
//
// Not a style checker. It only catches things that would actually break.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { dependencyProblems } from "./lib/approved-deps.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set([
  "node_modules",
  ".git",
  ".factory",
  ".next",
  ".vercel",
  ".agents",
  ".claude",
  ".tools",
  "test-results",
  "playwright-report",
]);
const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => relative(ROOT, p);

// 1. Every JS module has to parse.
for (const file of files.filter((f) => [".mjs", ".js"].includes(extname(f)))) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    problems.push(`${rel(file)}: syntax error\n${String(err.stderr ?? err.message).trim()}`);
  }
}

// 2. Every JSON file has to parse.
for (const file of files.filter((f) => extname(f) === ".json")) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    problems.push(`${rel(file)}: invalid JSON — ${err.message}`);
  }
}

// 3. Dependencies stay within the mission-approved set, pinned exactly, with
// one lockfile. The docs tooling itself (scripts/, docs/dashboard/) remains
// zero-dependency: it may import only node: builtins. See D020/D021.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
problems.push(...dependencyProblems(pkg));
if (!existsSync(join(ROOT, "package-lock.json"))) {
  problems.push("package-lock.json is missing — run `npm install` and commit it");
}

// 4. Generated artifacts must still declare themselves generated.
for (const generated of ["docs/DECISIONS.md", "docs/dashboard/decisions-data.js"]) {
  const body = readFileSync(join(ROOT, generated), "utf8");
  if (!body.includes("GENERATED FILE. Do not edit.")) {
    problems.push(`${generated}: lost its generated-file banner`);
  }
}

if (problems.length) {
  console.error(`\n[lint] ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}\n`);
  process.exit(1);
}
console.log(`[lint] ${files.length} file(s) checked, no problems`);
