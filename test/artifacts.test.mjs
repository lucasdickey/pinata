// Integrity tests for the real repository contents, as opposed to fixtures.
//
// These are the checks that catch the failure modes that actually happen: a
// generated file committed stale, a decision referencing a screenshot that was
// never added, a dashboard script reading a field the generator stopped emitting.

import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { validate, screenshotPaths } from "../scripts/lib/decisions.mjs";
import { ROOT, SOURCE, MD_OUT, JS_OUT, SHOT_DIR, renderAll, loadSource } from "../scripts/build-docs.mjs";
import { APPROVED_DEPENDENCIES, dependencyProblems } from "../scripts/lib/approved-deps.mjs";

const read = (p) => readFileSync(p, "utf8");

describe("the real decision log", () => {
  test("decisions.json is valid JSON", () => {
    assert.doesNotThrow(() => JSON.parse(read(SOURCE)));
  });

  test("decisions.json passes every validation rule", () => {
    const data = JSON.parse(read(SOURCE));
    assert.deepEqual(validate(data), []);
  });

  test("decision ids are sequential with no gaps", () => {
    const { decisions } = JSON.parse(read(SOURCE));
    const numbers = decisions.map((d) => Number(d.id.slice(1)));
    assert.deepEqual(
      numbers,
      numbers.map((_, i) => i + 1),
      "ids should run D001..DNNN in order",
    );
  });

  test("every referenced screenshot exists on disk", () => {
    const data = JSON.parse(read(SOURCE));
    for (const p of screenshotPaths(data)) {
      assert.ok(existsSync(join(SHOT_DIR, p)), `missing docs/dashboard/${p}`);
    }
  });

  test("loadSource resolves without throwing", () => {
    assert.doesNotThrow(() => loadSource());
  });
});

describe("generated artifacts are current", () => {
  // Mirrors `npm run docs:check`. Duplicated here so a bare `npm test` also
  // catches stale docs.
  test("DECISIONS.md matches what the generator would write", () => {
    const { files } = renderAll();
    assert.equal(
      read(MD_OUT),
      files[MD_OUT],
      "docs/DECISIONS.md is stale — run `npm run docs`",
    );
  });

  test("decisions-data.js matches what the generator would write", () => {
    const { files } = renderAll();
    assert.equal(
      read(JS_OUT),
      files[JS_OUT],
      "docs/dashboard/decisions-data.js is stale — run `npm run docs`",
    );
  });

  test("generated files warn against hand-editing", () => {
    for (const p of [MD_OUT, JS_OUT]) {
      assert.match(read(p), /GENERATED FILE\. Do not edit\./);
    }
  });

  test("every decision appears in the rendered markdown", () => {
    const { decisions } = JSON.parse(read(SOURCE));
    const md = read(MD_OUT);
    for (const d of decisions) {
      assert.ok(md.includes(`## ${d.id} — ${d.title}`), `${d.id} has no heading in DECISIONS.md`);
    }
  });
});

describe("the dashboard", () => {
  const html = read(join(ROOT, "docs/dashboard/index.html"));

  test("loads its data as a script, not via fetch (file:// blocks fetch)", () => {
    assert.match(html, /<script src="\.\/decisions-data\.js"><\/script>/);
    assert.ok(!/\bfetch\s*\(/.test(html), "dashboard must not depend on fetch");
  });

  test("pulls in no third-party assets", () => {
    const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)];
    assert.deepEqual(external.map((m) => m[0]), [], "dashboard must stay dependency-free");
  });

  test("every element the script looks up actually exists in the markup", () => {
    const ids = [...html.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, "expected the script to look up elements by id");
    for (const id of new Set(ids)) {
      assert.ok(
        new RegExp(`id=["']${id}["']`).test(html),
        `script reads #${id} but no element declares it`,
      );
    }
  });

  test("reads only fields the generator emits", () => {
    const { files } = renderAll();
    const sandbox = {};
    new Function("window", files[JS_OUT])(sandbox);
    const emitted = new Set(Object.keys(sandbox.PINATA));

    // The lookbehind keeps filenames like `decisions-data.js` out of the match.
    const accessed = new Set(
      [...html.matchAll(/(?<![\w-])data\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]),
    );
    for (const key of accessed) {
      assert.ok(emitted.has(key), `dashboard reads data.${key}, which the generator does not emit`);
    }
  });

  test("escapes untrusted-looking content before injecting it", () => {
    // Records are hand-authored, but the dashboard builds HTML by string
    // concatenation, so the escape helper has to stay in place.
    assert.match(html, /replace\(\/\[&<>"'\]\/g/);
  });
});

describe("repository contracts", () => {
  test("AGENTS.md documents the validation commands", () => {
    const agents = read(join(ROOT, "AGENTS.md"));
    for (const cmd of [
      "npm test",
      "npm run docs",
      "npm run docs:check",
      "npm run lint",
      "npm run typecheck",
      "npm run build",
      "npm run e2e",
      "npm run validate",
    ]) {
      assert.ok(agents.includes(cmd), `AGENTS.md should document \`${cmd}\``);
    }
  });

  test("every doc linked from README exists", () => {
    const readme = read(join(ROOT, "README.md"));
    const links = [...readme.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
    assert.ok(links.length > 0);
    for (const link of links) {
      assert.ok(existsSync(join(ROOT, link)), `README links ${link}, which does not exist`);
    }
  });

  test("dependencies stay within the approved set, pinned exactly", () => {
    const pkg = JSON.parse(read(join(ROOT, "package.json")));
    assert.deepEqual(dependencyProblems(pkg), []);
    // The application stack now exists, so the approved set must name it —
    // an empty allowlist here would mean the check is vacuous.
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        assert.ok(
          APPROVED_DEPENDENCIES[field].includes(name),
          `${name} is installed but missing from the approved set`,
        );
      }
    }
  });

  test("the docs tooling stays zero-dependency", () => {
    // The generator and dashboard must keep working from a bare checkout over
    // file://, so the docs tooling (scripts/build-docs.mjs, scripts/lib/) and
    // the dashboard may only import node: builtins or relative paths — never
    // a package from node_modules. Application scripts elsewhere in scripts/
    // (e.g. db-migrate.mjs) may use the approved dependency set; they are not
    // part of the bare-checkout docs path.
    const importSpecifiers = (source) =>
      [
        ...source.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']/g),
        ...source.matchAll(/import\s*["']([^"']+)["']/g),
        ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
      ].map((m) => m[1]);

    const docsLibDir = join(ROOT, "scripts", "lib");
    const files = [join(ROOT, "scripts", "build-docs.mjs")];
    const stack = [docsLibDir];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) stack.push(full);
        else if ([".mjs", ".js"].includes(extname(full))) files.push(full);
      }
    }
    files.push(join(ROOT, "docs/dashboard/decisions-data.js"));

    for (const file of files) {
      for (const spec of importSpecifiers(read(file))) {
        assert.ok(
          spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"),
          `${file} imports "${spec}" — the docs tooling must stay zero-dependency`,
        );
      }
    }
  });
});
