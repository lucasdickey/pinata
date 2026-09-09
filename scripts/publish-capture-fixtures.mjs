#!/usr/bin/env node
// Deploy the versioned capture fixtures to their durable public host: a tiny,
// separate Vercel project (pinata-fixtures) that serves test/fixtures/capture/
// as static files with deployment protection disabled (D041).
//
// Why this exists: Browserless runs in someone else's network, so a fixture it
// must load has to be reachable over public HTTPS as inline text/html. This
// project's own Vercel deployments sit behind deployment protection (an SSO
// redirect the provider cannot pass), and Vercel Blob force-serves HTML as an
// attachment (a documented anti-phishing measure), so neither can host a
// renderable fixture. The user directed a separate unprotected project instead:
// it is a different project, so the main `pinata` deployment protection stays
// untouched, and only inert fixture markup — no secrets, no application data —
// is ever served from it.
//
// The file in `test/fixtures/capture/` stays the source of truth. Every run:
//   1. ensures the project exists and deployment protection is disabled,
//   2. deploys the exact repository bytes to the production alias,
//   3. reads every fixture back and refuses to print a URL unless the response
//      is a direct 200 (no interstitial redirect), inline text/html with no
//      attachment disposition, and hashes to exactly the repository bytes,
//   4. rewrites test/fixtures/capture/host.json when the alias or bytes moved
//      (the durable URLs are public and non-secret, so they are committed),
//   5. prints the CAPTURE_*_FIXTURE_URL environment lines the real-provider
//      suite consumes.
//
// Usage:
//   node scripts/publish-capture-fixtures.mjs
//   eval "$(node scripts/publish-capture-fixtures.mjs --export)"

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const PROJECT_NAME = "pinata-fixtures";
const API_BASE = "https://api.vercel.com";
const EXEC_TIMEOUT_MS = 300_000;

const FIXTURES = [
  { envName: "CAPTURE_ECHO_FIXTURE_URL", file: "echo-v1.html", version: "echo-v1" },
  { envName: "CAPTURE_TALL_FIXTURE_URL", file: "tall-motion-v1.html", version: "tall-motion-v1" },
  { envName: "CAPTURE_MANIFEST_FIXTURE_URL", file: "manifest-v1.html", version: "manifest-v1" },
  { envName: "CAPTURE_LINKS_FIXTURE_URL", file: "links-v1.html", version: "links-v1" },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "capture");
const hostFile = path.join(fixtureDir, "host.json");

const run = promisify(execFile);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function vercel(args, options = {}) {
  try {
    return await run("vercel", args, {
      timeout: EXEC_TIMEOUT_MS,
      ...options,
    });
  } catch (error) {
    const detail = `${error.stderr ?? ""}${error.stdout ?? ""}`.trim();
    throw new Error(`vercel ${args.join(" ")} failed: ${detail || error.message}`);
  }
}

// The Vercel REST calls below authenticate with the CLI's own stored token.
// The token is read into memory and never printed.
async function readCliToken() {
  const candidates = [
    path.join(os.homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
    path.join(os.homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8"));
      if (typeof parsed.token === "string" && parsed.token) return parsed.token;
    } catch {
      // try the next platform location
    }
  }
  throw new Error("no Vercel CLI auth token found; run `vercel login` first");
}

// The CLI is linked to a team-scoped account, so API calls carry the orgId as
// teamId. Read it from the repository link metadata; never printed.
async function readOrgId() {
  const repo = JSON.parse(await readFile(path.join(repoRoot, ".vercel", "repo.json"), "utf8"));
  const orgId = typeof repo.orgId === "string" ? repo.orgId : repo.projects?.[0]?.orgId;
  if (typeof orgId !== "string" || !orgId) {
    throw new Error(".vercel/repo.json has no orgId; run `vercel link` in the repository");
  }
  return orgId;
}

async function api(token, orgId, method, route, body) {
  const response = await fetch(`${API_BASE}${route}?teamId=${encodeURIComponent(orgId)}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Vercel API ${method} ${route} failed with ${response.status}`);
  }
  return response.json();
}

async function ensureProject() {
  // `project add` fails when the project already exists; that is the common
  // idempotent path, so tolerate it and let the API read below be the proof.
  await run("vercel", ["project", "add", PROJECT_NAME], { timeout: EXEC_TIMEOUT_MS }).catch(
    () => {},
  );
}

// Deployment protection must be off on the fixture project so Browserless (and
// the readback below) reaches the files directly. This touches only the
// fixture project; the main project's protection is never modified.
async function disableProtection(token, orgId) {
  const project = await api(token, orgId, "PATCH", `/v9/projects/${PROJECT_NAME}`, {
    ssoProtection: null,
    passwordProtection: null,
    trustedIps: null,
  });
  if (project.ssoProtection || project.passwordProtection || project.trustedIps) {
    throw new Error(
      `deployment protection is still enabled on ${PROJECT_NAME}; refusing to publish`,
    );
  }
  return project;
}

function deploymentUrlFromOutput(stdout) {
  const match = stdout.match(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  if (!match) throw new Error("could not find the deployment URL in the CLI output");
  return match[0];
}

// The durable base URL is the project's production alias (pinata-fixtures's
// default .vercel.app domain), not the per-deployment URL. The deployment
// record lists every alias; the project domain is the shortest one.
async function productionAlias(token, orgId, deploymentUrl) {
  const host = new URL(deploymentUrl).host;
  const deployment = await api(token, orgId, "GET", `/v13/deployments/${host}`);
  const aliases = (deployment.alias ?? []).filter((alias) => alias.endsWith(".vercel.app"));
  if (aliases.length === 0) throw new Error("the deployment has no .vercel.app alias");
  aliases.sort((a, b) => a.length - b.length);
  return `https://${aliases[0]}`;
}

// A candidate fixture host must prove four things per fixture before any URL
// is trusted: a direct 200 (no interstitial/SSO redirect), inline text/html,
// no attachment disposition, and bytes identical to the repository file.
async function verifyReadback(url, bytes) {
  const response = await fetch(url, { redirect: "manual", cache: "no-store" });
  if (response.status !== 200) {
    throw new Error(
      `${url}: expected a direct 200, got ${response.status} (an interstitial or protection redirect would fail here)`,
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("text/html")) {
    throw new Error(`${url}: host served ${contentType}, not text/html`);
  }
  const disposition = response.headers.get("content-disposition") || "";
  if (disposition.toLowerCase().includes("attachment")) {
    throw new Error(`${url}: host forces a download (Content-Disposition: ${disposition})`);
  }
  const served = new Uint8Array(await response.arrayBuffer());
  if (sha256(served) !== sha256(bytes)) {
    throw new Error(`${url}: served bytes do not match the repository fixture`);
  }
}

async function main() {
  const asExport = process.argv.includes("--export");

  const fixtures = [];
  for (const fixture of FIXTURES) {
    const bytes = await readFile(path.join(fixtureDir, fixture.file));
    fixtures.push({ ...fixture, bytes });
  }

  const token = await readCliToken();
  const orgId = await readOrgId();

  await ensureProject();
  await disableProtection(token, orgId);

  const staging = await mkdtemp(path.join(os.tmpdir(), "pinata-fixtures-"));
  try {
    for (const fixture of fixtures) {
      await cp(path.join(fixtureDir, fixture.file), path.join(staging, fixture.file));
    }
    // Static files at the project root, served verbatim. Force the "Other"
    // framework preset so no build step ever runs against fixture markup.
    await writeFile(
      path.join(staging, "vercel.json"),
      JSON.stringify({ framework: null, cleanUrls: false, trailingSlash: false }, null, 2) + "\n",
    );
    await vercel(["link", "--yes", "--project", PROJECT_NAME], { cwd: staging });
    const deployed = await vercel(["deploy", "--prod", "--yes"], { cwd: staging });
    const deploymentUrl = deploymentUrlFromOutput(deployed.stdout);
    const baseUrl = await productionAlias(token, orgId, deploymentUrl);

    const published = [];
    for (const fixture of fixtures) {
      const url = `${baseUrl}/${fixture.file}`;
      await verifyReadback(url, fixture.bytes);
      published.push({ ...fixture, url });
    }

    const host = {
      project: PROJECT_NAME,
      baseUrl,
      deploymentProtection: "disabled",
      fixtures: Object.fromEntries(
        published.map((entry) => [
          entry.version,
          {
            url: entry.url,
            file: entry.file,
            bytes: entry.bytes.byteLength,
            sha256: sha256(entry.bytes),
          },
        ]),
      ),
    };
    const serialized = JSON.stringify(host, null, 2) + "\n";
    const current = await readFile(hostFile, "utf8").catch(() => null);
    if (current !== serialized) await writeFile(hostFile, serialized);

    for (const entry of published) {
      if (asExport) {
        console.log(`export ${entry.envName}=${entry.url}`);
      } else {
        console.log(
          `${entry.envName}=${entry.url}  version=${entry.version} bytes=${entry.bytes.byteLength} sha256=${sha256(entry.bytes)}`,
        );
      }
    }
    if (!asExport) {
      console.log(
        `host=${baseUrl} project=${PROJECT_NAME} protection=disabled (durable; no expiry)`,
      );
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await main();
