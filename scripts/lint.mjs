#!/usr/bin/env node
// Dependency-free lint: syntax-check every JS module, and enforce the two
// repository rules that are easy to break by accident (no stray dependencies,
// no hand-edits to generated files).
//
// Not a style checker. It only catches things that would actually break.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", ".factory"]);
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

// 3. No dependencies. The docs tooling must keep working without an install.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
  const names = Object.keys(pkg[field] ?? {});
  if (names.length) {
    problems.push(`package.json: ${field} must stay empty, found ${names.join(", ")}`);
  }
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
