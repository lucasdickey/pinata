#!/usr/bin/env node
// Publish the versioned capture fixtures to a temporary public HTTPS host and
// print the URLs the real-provider capture checks need.
//
// Why this exists: Browserless runs in someone else's network, so a fixture it
// must load has to be reachable over public HTTPS. This project's own Vercel
// deployments sit behind deployment protection, and the fixtures are test
// data that does not belong in the application's public surface, so the run
// publishes the repository's versioned file to a disposable public URL
// instead. The file in `test/fixtures/capture/` stays the source of truth: the
// script verifies that what the host serves back hashes to exactly the bytes
// it uploaded before printing anything.
//
// The objects expire on their own (one hour) and contain inert fixture markup
// only: no secrets, no application data, no provider detail.
//
// Usage:
//   node scripts/publish-capture-fixtures.mjs
//   eval "$(node scripts/publish-capture-fixtures.mjs --export)"

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HOST_ENDPOINT = "https://litterbox.catbox.moe/resources/internals/api.php";
const RETENTION = "1h";

const FIXTURES = [
  { envName: "CAPTURE_ECHO_FIXTURE_URL", file: "echo-v1.html", version: "echo-v1" },
  { envName: "CAPTURE_TALL_FIXTURE_URL", file: "tall-motion-v1.html", version: "tall-motion-v1" },
  { envName: "CAPTURE_MANIFEST_FIXTURE_URL", file: "manifest-v1.html", version: "manifest-v1" },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "..", "test", "fixtures", "capture");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function publish(fixture) {
  const bytes = await readFile(path.join(fixtureDir, fixture.file));
  const form = new FormData();
  form.set("reqtype", "fileupload");
  form.set("time", RETENTION);
  form.set("fileToUpload", new Blob([bytes], { type: "text/html" }), fixture.file);

  const response = await fetch(HOST_ENDPOINT, { method: "POST", body: form });
  if (!response.ok) throw new Error(`${fixture.file}: upload failed with ${response.status}`);
  const url = (await response.text()).trim();
  if (!url.startsWith("https://")) throw new Error(`${fixture.file}: host returned no https URL`);

  const readback = await fetch(url, { cache: "no-store" });
  if (!readback.ok) throw new Error(`${fixture.file}: readback failed with ${readback.status}`);
  const contentType = readback.headers.get("content-type") || "";
  if (!contentType.startsWith("text/html")) {
    throw new Error(`${fixture.file}: host served ${contentType}, not text/html`);
  }
  const served = new Uint8Array(await readback.arrayBuffer());
  if (sha256(served) !== sha256(bytes)) {
    throw new Error(`${fixture.file}: served bytes do not match the repository fixture`);
  }

  return { ...fixture, url, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

const asExport = process.argv.includes("--export");
const published = [];
for (const fixture of FIXTURES) {
  published.push(await publish(fixture));
}

for (const entry of published) {
  if (asExport) {
    console.log(`export ${entry.envName}=${entry.url}`);
  } else {
    console.log(
      `${entry.envName}=${entry.url}  version=${entry.version} bytes=${entry.bytes} sha256=${entry.sha256}`,
    );
  }
}
if (!asExport) console.log(`retention=${RETENTION}`);
