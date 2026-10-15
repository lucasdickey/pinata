// Replay a seed (scripts/seed/*.json) into a running Pinata through its own
// API, stage by stage, so a scratch database ends up in a known state with
// real captures, real marks, and real replies. Going through the API, not a
// database file, keeps a seed valid across schema migrations: it breaks only
// when the API it speaks changes, and then it breaks loudly.
//
// Stages, each building on the last:
//   empty       nothing at all, for a story that starts from scratch
//   captured    the project, with every page captured on each device
//   marked      the seed's marks, each with its comment and its element
//   shared      a founder link
//   replied     the founder's replies, posted through the founder session
//   handed-off  an agent link
//
// Library: applySeed({ browser, base, password, seedFile, until }).
// CLI:     EDITOR_PASSWORD=... node scripts/seed/apply.mjs --base URL [--until STAGE] [seed.json]
//          (scripts/seed/scratch.mjs starts a scratch server and applies a seed for you)

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureSite } from "./capture-site.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SEED = resolve(HERE, "chickpea.json");
export const STAGES = ["empty", "captured", "marked", "shared", "replied", "handed-off"];

const CSRF_COOKIE = "pinata_csrf";
const FOUNDER_CSRF_COOKIE = "pinata_founder_csrf";
const CSRF_HEADER = "x-pinata-csrf";

async function ok(response, what) {
  if (response.ok()) return response.json();
  let detail = "";
  try {
    detail = JSON.stringify(await response.json());
  } catch {
    // A body that is not JSON says nothing more than the status.
  }
  throw new Error(`seed: ${what} failed with ${response.status()} ${detail}`);
}

/** Where a mark points: the spot its element should contain or sit nearest to. */
function anchorOf(mark) {
  if (mark.tip) return mark.tip;
  if (mark.rect) return { x: mark.rect.x + mark.rect.width / 2, y: mark.rect.y + mark.rect.height / 2 };
  if (mark.circle) {
    return { x: mark.circle.x + mark.circle.size / 2, y: mark.circle.y + mark.circle.size / 2 };
  }
  return mark.arrow.end;
}

/**
 * The capture's element a seed mark names: same tag and text, and among
 * several, the one whose box holds (or sits nearest to) the mark's anchor.
 */
export function findElement(manifest, mark) {
  if (!mark.element) return null;
  const matches = manifest.elements.filter(
    (element) => element.tag === mark.element.tag && element.text === mark.element.text,
  );
  if (matches.length === 0) {
    throw new Error(`seed: mark "${mark.key}" names <${mark.element.tag}> "${mark.element.text}", which the capture does not have`);
  }
  const at = anchorOf(mark);
  const distance = ({ rect }) => {
    const dx = Math.max(rect.x - at.x, 0, at.x - (rect.x + rect.width));
    const dy = Math.max(rect.y - at.y, 0, at.y - (rect.y + rect.height));
    return Math.hypot(dx, dy);
  };
  return matches.reduce((best, element) => (distance(element) < distance(best) ? element : best));
}

/** Sign a browser context in as the editor; returns the headers a mutation needs. */
export async function signInEditor(context, base, password) {
  await ok(
    await context.request.post(`${base}/api/auth/login`, {
      headers: { origin: base },
      data: { password },
    }),
    "editor sign-in",
  );
  const csrf = (await context.cookies(base)).find((cookie) => cookie.name === CSRF_COOKIE)?.value;
  if (!csrf) throw new Error("seed: sign-in set no CSRF cookie");
  return { origin: base, [CSRF_HEADER]: csrf };
}

/**
 * Capture one seed page on each of its devices and import it: into a new
 * project named `title` when `project` is null, into that project otherwise,
 * and onto an existing page when `pageId` is given.
 */
export async function importPage({ browser, context, base, headers, seedDir, page, project, pageId = null, title, key }) {
  const capturedAt = Date.now() - (page.capturedMinutesAgo ?? 0) * 60_000;
  const entry = { project: null, id: pageId, url: page.url, captures: {}, manifests: {} };
  for (const variant of page.variants) {
    const shot = await captureSite(browser, { file: resolve(seedDir, page.site), url: page.url, variant });
    const owner = project ?? entry.project?.publicId ?? null;
    const target = owner
      ? entry.id
        ? { project: owner, page: entry.id }
        : { project: owner }
      : { newProject: { title } };
    const meta = {
      idempotencyKey: key(`${page.key}-${variant}`),
      target,
      ...(entry.id ? {} : { url: page.url }),
      variant,
      capturedAt,
      document: shot.document,
      manifest: shot.manifest,
    };
    const result = await ok(
      await context.request.post(`${base}/api/imports`, {
        headers,
        multipart: {
          meta: JSON.stringify(meta),
          image: { name: `${page.key}-${variant}.png`, mimeType: shot.image.contentType, buffer: shot.image.bytes },
        },
      }),
      `import of ${page.url} (${variant})`,
    );
    entry.project ??= { publicId: result.project.publicId, title: result.project.title };
    entry.id = result.page.id;
    entry.captures[variant] = result.capture.id;
    entry.manifests[variant] = shot.manifest;
  }
  return entry;
}

/**
 * Apply a seed up to and including `until`. Returns everything a caller
 * needs to find what it made: the project, each page's captures, each mark's
 * annotation, and the founder and agent links.
 *
 * @param {{ browser: import("@playwright/test").Browser, base: string, password: string,
 *   seedFile?: string, until?: string, log?: (line: string) => void }} options
 */
export async function applySeed({ browser, base, password, seedFile = DEFAULT_SEED, until = "replied", log = () => {} }) {
  const last = STAGES.indexOf(until);
  if (last < 0) throw new Error(`seed: unknown stage "${until}"; stages are ${STAGES.join(", ")}`);
  const reached = (stage) => STAGES.indexOf(stage) <= last;
  const seed = JSON.parse(await readFile(seedFile, "utf8"));
  const seedDir = dirname(seedFile);
  const run = Date.now().toString(36);
  const key = (name) => `seed-${run}-${name}`.slice(0, 128);

  const editor = await browser.newContext();
  const founder = await browser.newContext();
  try {
    const editorHeaders = await signInEditor(editor, base, password);

    // captured: import every page on every device, as the extension would.
    const state = { project: null, pages: {}, marks: {}, founderUrl: null, agentUrl: null };
    for (const page of reached("captured") ? seed.pages : []) {
      const entry = await importPage({
        browser,
        context: editor,
        base,
        headers: editorHeaders,
        seedDir,
        page,
        project: state.project?.publicId ?? null,
        title: seed.project.title,
        key,
      });
      state.project ??= entry.project;
      delete entry.project;
      state.pages[page.key] = entry;
      log(`captured ${page.url} on ${page.variants.join(" and ")}`);
    }

    // marked: each mark with its comment and its element, in seed order.
    if (reached("marked")) {
      for (const mark of seed.marks) {
        const page = state.pages[mark.page];
        const captureId = page.captures[mark.variant];
        const element = findElement(page.manifests[mark.variant], mark);
        const geometry = { pin: "tip", rectangle: "rect", circle: "circle", arrow: "arrow" }[mark.kind];
        const created = await ok(
          await editor.request.post(`${base}/api/captures/${captureId}/annotations`, {
            headers: editorHeaders,
            data: {
              [geometry]: mark[geometry],
              body: mark.body,
              elementId: element ? element.id : null,
              idempotencyKey: key(`mark-${mark.key}`),
            },
          }),
          `mark "${mark.key}"`,
        );
        state.marks[mark.key] = { id: created.annotation.id, number: created.annotation.number, captureId };
        log(`marked ${mark.kind} ${created.annotation.number}: ${mark.key}`);
      }
    }

    // shared: the founder link, whose token is shown exactly once.
    let founderToken = null;
    if (reached("shared")) {
      const share = await ok(
        await editor.request.post(`${base}/api/projects/${state.project.publicId}/share`, { headers: editorHeaders }),
        "founder link",
      );
      founderToken = share.token;
      state.founderUrl = `${base}${share.path}#${share.token}`;
      log("shared the founder link");
    }

    // replied: the founder signs in with the link and answers.
    if (reached("replied")) {
      await ok(
        await founder.request.post(`${base}/api/founder/${state.project.publicId}/session`, {
          headers: { origin: base },
          data: { token: founderToken },
        }),
        "founder session",
      );
      const founderCsrf = (await founder.cookies(base)).find((cookie) => cookie.name === FOUNDER_CSRF_COOKIE)?.value;
      for (const mark of seed.marks) {
        for (const [index, reply] of mark.replies.entries()) {
          if (reply.author !== "founder") continue;
          const { id, captureId } = state.marks[mark.key];
          await ok(
            await founder.request.post(`${base}/api/captures/${captureId}/annotations/${id}/thread`, {
              headers: { origin: base, [CSRF_HEADER]: founderCsrf },
              data: { body: reply.body, idempotencyKey: key(`reply-${mark.key}-${index}`) },
            }),
            `founder reply on "${mark.key}"`,
          );
          log(`founder replied on ${mark.key}`);
        }
      }
    }

    // handed-off: the agent link.
    if (reached("handed-off")) {
      const agent = await ok(
        await editor.request.post(`${base}/api/projects/${state.project.publicId}/agent-link`, { headers: editorHeaders }),
        "agent link",
      );
      state.agentUrl = `${base}${agent.path}`;
      log("created the agent link");
    }

    for (const page of Object.values(state.pages)) delete page.manifests;
    return state;
  } finally {
    await editor.close();
    await founder.close();
  }
}

// CLI: apply a seed to a server that is already running.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const base = option("--base") ?? "http://127.0.0.1:3100";
  const until = option("--until") ?? "replied";
  const seedFile = args[0] ? resolve(args[0]) : DEFAULT_SEED;
  const password = process.env.EDITOR_PASSWORD;
  if (!password) {
    console.error("seed: set EDITOR_PASSWORD to the running server's editor password.");
    process.exit(1);
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const state = await applySeed({ browser, base, password, seedFile, until, log: (line) => console.log(`seed: ${line}`) });
    console.log(JSON.stringify({ project: state.project, founderUrl: state.founderUrl ? "(created)" : null }, null, 2));
  } finally {
    await browser.close();
  }
}
