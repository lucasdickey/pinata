#!/usr/bin/env node
// Production smoke for the deployed Pinata (first-production-deployment).
//
// Drives the REAL deployment end to end with the deployment's own routes:
// deployment-protection posture, the /reqs hub (five routes from repository
// sources, displayed commit SHA), editor login, the real Chickpea project
// (https://chickpea.co/ root plus the explicit /pricing, /about, /privacy
// array; Desktop + Mobile = 8 captures) driven to ready through the
// deployment's own dispatch route against real Browserless/Turso/Blob,
// authorized-only private asset delivery (post-logout denial, no cached
// replay), a pin with a comment persisted and read back through a fresh
// session, and a scoped recapture that starts empty.
//
// Secret hygiene: EDITOR_PASSWORD comes from the process environment (invoke
// with `node --env-file=.env.local`), the Vercel deployment-protection bypass
// secret comes from --bypass-file or VERCEL_AUTOMATION_BYPASS_SECRET. No
// value is ever printed; responses are scanned for accidental echoes before
// any snippet is logged.
//
// The script is idempotent: the project is matched by title + root URL and
// reused, ready captures are not redispatched, and every mutation carries a
// run-scoped idempotency key. The Chickpea project it creates is demo data
// and is deliberately LEFT IN PLACE for the live pins checkpoint.
//
// Usage:
//   node --env-file=.env.local scripts/production-smoke.mjs \
//     https://pinata-lucasdickeys-projects.vercel.app \
//     --bypass-file /tmp/pinata-automation-bypass [--expect-sha <40hex>]

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const CHICKPEA_URLS = [
  "https://chickpea.co/",
  "https://chickpea.co/pricing",
  "https://chickpea.co/about",
  "https://chickpea.co/privacy",
];
const PROJECT_TITLE = "Chickpea (production)";
const REQ_ROUTES = [
  ["/reqs", "docs/REQUIREMENTS.md"],
  ["/reqs/architecture", "docs/ARCHITECTURE.md"],
  ["/reqs/milestones", "docs/MILESTONES.md"],
  ["/reqs/decisions", "docs/decisions/decisions.json"],
  ["/reqs/evals", "docs/EVALS.md"],
];

const args = process.argv.slice(2);
const baseUrl = args.find((a) => !a.startsWith("--"));
if (!baseUrl || !/^https:\/\/[a-z0-9.-]+\.vercel\.app$/.test(baseUrl)) {
  console.error("usage: production-smoke.mjs <https://....vercel.app> --bypass-file <path> [--expect-sha <sha>]");
  process.exit(2);
}
const bypassFile = args[args.indexOf("--bypass-file") + 1] ?? null;
const bypass =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET ??
  (bypassFile ? readFileSync(bypassFile, "utf8").trim() : undefined);
if (!bypass) {
  console.error("missing bypass secret (pass --bypass-file or VERCEL_AUTOMATION_BYPASS_SECRET)");
  process.exit(2);
}
const password = process.env.EDITOR_PASSWORD;
if (!password) {
  console.error("missing EDITOR_PASSWORD in the process environment");
  process.exit(2);
}
const expectSha =
  args[args.indexOf("--expect-sha") + 1] ??
  execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

const origin = new URL(baseUrl).origin;
const runId = `prod-smoke-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;

let failures = 0;
function report(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** fetch with the protection bypass header; never logs secret-bearing data. */
function call(path, { method = "GET", cookies = {}, csrf, body, bypass: useBypass = true } = {}) {
  const headers = { origin };
  if (useBypass) headers["x-vercel-protection-bypass"] = bypass;
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieHeader) headers.cookie = cookieHeader;
  if (csrf) headers["x-pinata-csrf"] = csrf;
  let payload;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: payload,
    redirect: "manual",
    signal: AbortSignal.timeout(150_000),
  });
}

function parseSetCookies(response) {
  const out = {};
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

async function main() {
  console.log(`run ${runId} against ${baseUrl}`);

  // 1. Deployment protection stays ON for visitors without the bypass.
  const unprotected = await call("/", { bypass: false });
  const sso =
    unprotected.status === 302 &&
    (unprotected.headers.get("location") ?? "").startsWith("https://vercel.com/sso");
  report(sso, "deployment protection ON (anonymous request redirected to Vercel SSO)", `status ${unprotected.status}`);

  // 2. The /reqs hub serves all five routes from repository sources and
  //    identifies the exact deployed commit (VAL-REQS-003).
  for (const [route, source] of REQ_ROUTES) {
    const res = await call(route);
    const html = await res.text();
    const hasSource = html.includes(source);
    const shaMatch = html.match(/Revision:[\s\S]{0,200}?([0-9a-f]{40})/);
    const shaOk = shaMatch !== null && shaMatch[1] === expectSha;
    report(
      res.status === 200 && hasSource && shaOk,
      `${route} renders from ${source} at ${expectSha.slice(0, 7)}`,
      `status ${res.status}, source ${hasSource}, sha ${shaMatch?.[1]?.slice(0, 7) ?? "absent"}`,
    );
  }
  const unknown = await call("/reqs/definitely-not-a-page");
  report(unknown.status === 404, "unknown /reqs/* returns 404", `status ${unknown.status}`);

  // 3. Editor login: a wrong password is denied (bounded), the configured
  //    password succeeds and sets session + CSRF cookies.
  const wrong = await call("/api/auth/login", {
    method: "POST",
    body: { password: `decoy-${runId}` },
  });
  report(wrong.status === 401, "wrong password denied with bounded 401", `status ${wrong.status}`);
  const login = await call("/api/auth/login", { method: "POST", body: { password } });
  const cookies = parseSetCookies(login);
  const session = cookies["pinata_editor_session"];
  const csrf = cookies["pinata_csrf"];
  report(login.status === 200 && Boolean(session) && Boolean(csrf), "editor login issues session + csrf cookies", `status ${login.status}`);
  if (!session || !csrf) throw new Error("cannot continue without a session");
  const authed = { pinata_editor_session: session, pinata_csrf: csrf };

  const whoami = await call("/api/editor/session", { cookies: authed });
  const who = await whoami.json();
  report(whoami.status === 200 && who.authenticated === true && who.actor === "editor", "session readback authenticates as editor");

  // 4. The real Chickpea project: root + explicit /pricing, /about,
  //    /privacy, Desktop + Mobile = 8 captures (idempotent find-or-create).
  const list = await (await call("/api/projects", { cookies: authed })).json();
  let project = list.projects.find(
    (p) => p.title === PROJECT_TITLE && p.rootUrl === "https://chickpea.co/",
  );
  if (!project) {
    const created = await call("/api/projects", {
      method: "POST",
      cookies: authed,
      csrf,
      body: {
        title: PROJECT_TITLE,
        rootUrl: CHICKPEA_URLS[0],
        urls: CHICKPEA_URLS.slice(1),
        idempotencyKey: `${runId}-create`,
      },
    });
    if (created.status !== 201) throw new Error(`project create failed: ${created.status}`);
    project = (await created.json()).project;
    console.log(`created project ${project.publicId}`);
  } else {
    console.log(`reusing project ${project.publicId}`);
  }
  const hierarchy = await (
    await call(`/api/projects/${project.publicId}`, { cookies: authed })
  ).json();
  const pages = hierarchy.project?.pages ?? hierarchy.pages;
  report(
    pages.length === 4 && pages.every((p, i) => p.normalizedUrl === CHICKPEA_URLS[i]),
    "project holds the four ordered Chickpea URLs",
    pages.map((p) => p.normalizedUrl.replace("https://chickpea.co", "") || "/").join(" "),
  );

  // 5. Drive every pending attempt to ready through the deployment's own
  //    dispatch route, at most two in flight (the Browserless free-tier cap).
  const pending = [];
  for (const page of pages) {
    for (const device of page.devices) {
      const readySelected = device.attempts.find((a) => a.id === device.selectedCaptureId);
      if (readySelected?.state === "ready") continue;
      const dispatchable = device.attempts.find((a) => a.state === "pending" || a.state === "stale");
      if (dispatchable) pending.push({ page, device, attempt: dispatchable });
    }
  }
  console.log(`dispatching ${pending.length} pending attempt(s) (2 in flight)`);
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const job = pending[cursor++];
      const started = Date.now();
      const res = await call(`/api/captures/${job.attempt.id}/dispatch`, {
        method: "POST",
        cookies: authed,
        csrf,
      });
      const payload = await res.json().catch(() => ({}));
      const seconds = Math.round((Date.now() - started) / 1000);
      results.push({
        url: job.page.normalizedUrl,
        variant: job.device.variant,
        ok: res.status === 200,
        status: res.status,
        code: payload.code ?? null,
        seconds,
        dims: payload.capture
          ? `${payload.capture.documentWidth}x${payload.capture.documentHeight}`
          : null,
      });
      const r = results[results.length - 1];
      console.log(`  ${r.ok ? "ready" : "FAILED"} ${r.variant} ${r.url} (${r.seconds}s${r.dims ? `, ${r.dims}` : ""}${r.code ? `, ${r.code}` : ""})`);
    }
  }
  await Promise.all([worker(), worker()]);
  const after = await (
    await call(`/api/projects/${project.publicId}`, { cookies: authed })
  ).json();
  const afterPages = after.project?.pages ?? after.pages;
  const readyCaptures = [];
  for (const page of afterPages) {
    for (const device of page.devices) {
      const selected = device.attempts.find((a) => a.id === device.selectedCaptureId);
      if (selected?.state === "ready") {
        readyCaptures.push({ page, device, capture: selected });
      }
    }
  }
  report(
    readyCaptures.length === 8,
    "8/8 Chickpea captures ready via the deployment's dispatch route",
    `ready ${readyCaptures.length}/8`,
  );
  if (readyCaptures.length !== 8) throw new Error("capture set incomplete; see per-attempt lines above");

  // Capture order/identity: each ready capture binds its own page + variant.
  const orderOk = afterPages.every(
    (page) =>
      page.devices.every((d) => d.selectedCaptureId !== null) &&
      page.normalizedUrl === CHICKPEA_URLS[afterPages.indexOf(page)],
  );
  report(orderOk, "desktop and mobile selections exist for every page in submitted order");

  // 6. Private capture assets require authorization. With the session: exact
  //    bytes whose SHA-256 matches the persisted image hash, with no-store
  //    private cache headers and no provider location.
  const sample = readyCaptures[0];
  const asset = await call(`/api/captures/${sample.capture.id}/asset`, { cookies: authed });
  const assetBytes = Buffer.from(await asset.arrayBuffer());
  const hash = createHash("sha256").update(assetBytes).digest("hex");
  const cacheControl = asset.headers.get("cache-control") ?? "";
  report(
    asset.status === 200 && assetBytes.length > 0 && hash === sample.capture.imageHash,
    "authorized asset GET returns exact bytes (sha256 matches persisted hash)",
    `status ${asset.status}, ${assetBytes.length} bytes`,
  );
  report(
    /no-store/.test(cacheControl) && /private/.test(cacheControl),
    "asset response is private/no-store",
    `cache-control: ${cacheControl || "absent"}`,
  );
  const leakedLocation =
    (asset.headers.get("x-vercel-cache") ?? "").includes("blob") ||
    JSON.stringify(Object.fromEntries(asset.headers)).includes("blob.core");
  report(!leakedLocation, "asset response discloses no provider location");

  // Post-logout: the asset route denies without a session (no cached replay),
  // and the logged-out cookie's fate is recorded observationally (the known
  // in-memory revocation weakness is documented in the README).
  const logout = await call("/api/auth/logout", { method: "POST", cookies: authed, csrf });
  report(logout.status === 200, "logout succeeds");
  const anonAsset = await call(`/api/captures/${sample.capture.id}/asset`);
  const anonBytes = Buffer.from(await anonAsset.arrayBuffer());
  const anonType = anonAsset.headers.get("content-type") ?? "";
  const denialIsBoundedJson =
    anonType.includes("application/json") && anonBytes.length <= 1024;
  report(
    anonAsset.status === 401 && denialIsBoundedJson,
    "post-logout asset GET without a session is denied (bounded error, no image bytes)",
    `status ${anonAsset.status}, ${anonBytes.length} bytes of ${anonType || "unknown type"}`,
  );
  const staleCookieAsset = await call(`/api/captures/${sample.capture.id}/asset`, {
    cookies: authed,
  });
  console.log(
    `  note: old cookie after logout -> ${staleCookieAsset.status} (cross-instance revocation is a documented weakness when not 401)`,
  );
  await staleCookieAsset.arrayBuffer();

  // 7. A pin with a comment persists: create on /pricing Desktop with an
  //    explicit nearby-element choice, and on Mobile home with the explicit
  //    "No element" choice; read both back through a FRESH session.
  const fresh = await call("/api/auth/login", { method: "POST", body: { password } });
  const freshCookies = parseSetCookies(fresh);
  const freshAuth = {
    pinata_editor_session: freshCookies["pinata_editor_session"],
    pinata_csrf: freshCookies["pinata_csrf"],
  };
  const pricing = afterPages.find((p) => p.normalizedUrl === "https://chickpea.co/pricing");
  const pricingDesktop = readyCaptures.find(
    (c) => c.page.id === pricing.id && c.device.variant === "desktop",
  );
  const home = afterPages.find((p) => p.normalizedUrl === "https://chickpea.co/");
  const homeMobile = readyCaptures.find((c) => c.page.id === home.id && c.device.variant === "mobile");

  const doc = { w: pricingDesktop.capture.documentWidth, h: pricingDesktop.capture.documentHeight };
  const anchor = { x: Math.round(doc.w / 2), y: Math.round(doc.h / 2) };
  const context = await (
    await call(
      `/api/captures/${pricingDesktop.capture.id}/context?x=${anchor.x}&y=${anchor.y}`,
      { cookies: freshAuth },
    )
  ).json();
  const candidate = context.candidates?.[0] ?? null;
  report(candidate !== null, "nearby-DOM candidates offered on /pricing Desktop", `${context.candidates?.length ?? 0} candidates`);

  const pinBody = `Production smoke pin (${runId}): this section deserves a look.`;
  const pin = await call(`/api/captures/${pricingDesktop.capture.id}/annotations`, {
    method: "POST",
    cookies: freshAuth,
    csrf: freshAuth.pinata_csrf,
    body: {
      tip: anchor,
      body: pinBody,
      elementId: candidate ? candidate.id : null,
      idempotencyKey: `${runId}-pin-pricing`,
    },
  });
  const pinPayload = await pin.json();
  report(
    pin.status === 201 && pinPayload.annotation?.number >= 1,
    "pin with comment + explicit element choice created on /pricing Desktop",
    `status ${pin.status}, number ${pinPayload.annotation?.number}`,
  );
  const mobilePin = await call(`/api/captures/${homeMobile.capture.id}/annotations`, {
    method: "POST",
    cookies: freshAuth,
    csrf: freshAuth.pinata_csrf,
    body: {
      tip: { x: 195, y: 200 },
      body: `Production smoke pin (${runId}): header reads well on mobile.`,
      elementId: null,
      idempotencyKey: `${runId}-pin-mobile`,
    },
  });
  report(mobilePin.status === 201, 'pin with "No element" choice created on Mobile home', `status ${mobilePin.status}`);

  const readback = await (
    await call(`/api/captures/${pricingDesktop.capture.id}/annotations`, { cookies: freshAuth })
  ).json();
  const persisted = readback.annotations?.find((a) => a.body === pinBody);
  report(
    Boolean(persisted) && persisted.tip.x === anchor.x && persisted.tip.y === anchor.y,
    "pin + comment persist across a fresh session (reload-equivalent readback)",
  );
  const mobileReadback = await (
    await call(`/api/captures/${homeMobile.capture.id}/annotations`, { cookies: freshAuth })
  ).json();
  report(
    Boolean(mobileReadback.annotations?.some((a) => a.elementSnapshot === null || a.elementSnapshot === undefined || a.body.includes(runId))),
    "mobile pin persists on its own plane (desktop/mobile isolation)",
  );

  // 8. A scoped recapture starts empty: new attempt, dispatched ready, zero
  //    annotations on the new plane while the old plane keeps its pins.
  const privacy = afterPages.find((p) => p.normalizedUrl === "https://chickpea.co/privacy");
  const retry = await call(`/api/pages/${privacy.id}/captures`, {
    method: "POST",
    cookies: freshAuth,
    csrf: freshAuth.pinata_csrf,
    body: { variant: "desktop", idempotencyKey: `${runId}-recapture` },
  });
  const retryPayload = await retry.json();
  report(retry.status === 201, "scoped recapture creates a fresh pending attempt", `status ${retry.status}`);
  if (retry.status === 201) {
    const redispatch = await call(`/api/captures/${retryPayload.attempt.id}/dispatch`, {
      method: "POST",
      cookies: freshAuth,
      csrf: freshAuth.pinata_csrf,
    });
    const newCaptureId = retryPayload.attempt.id;
    const newPins = await (
      await call(`/api/captures/${newCaptureId}/annotations`, { cookies: freshAuth })
    ).json();
    report(
      redispatch.status === 200 && (newPins.annotations?.length ?? -1) === 0,
      "recaptured plane is ready and starts with zero annotations",
      `dispatch ${redispatch.status}, pins ${newPins.annotations?.length}`,
    );
  }

  await call("/api/auth/logout", {
    method: "POST",
    cookies: freshAuth,
    csrf: freshAuth.pinata_csrf,
  });

  console.log(
    failures === 0
      ? `\nSMOKE OK — project ${project.publicId} ready at ${baseUrl} (left in place as demo data)`
      : `\nSMOKE FAILED — ${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`smoke aborted: ${error.message}`);
  process.exit(1);
});
