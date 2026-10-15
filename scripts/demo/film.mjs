// Film the landing's demo video (remotion/demo/README.md): drive the real
// product through the story in scripts/demo/story.mjs and save each shot it
// takes — a screenshot of the browser plus where its targets sit — so the
// composition in remotion/demo/ can move a cursor, type, draw, and zoom over
// real screens.
//
//   npm run build
//   npm run demo:film                        every scene, light and dark
//   npm run demo:film -- --scenes share,agent  only those scenes' shots
//   npm run demo:film -- --themes light      one theme
//   npm run demo:film -- --list              each scene: when it was filmed, and whether its screens changed since
//
// Each theme runs on its own scratch Pinata (scripts/seed/scratch.mjs): a
// fresh file database, local screenshots, nothing shared. A partial run
// seeds straight to the first chosen scene's starting stage
// (scripts/seed/apply.mjs) and films forward from there, so the scenes it
// skips keep their shots. Shots land in public/demo/ as WebP; their targets,
// sizes, and provenance land in remotion/demo/shots.json.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { applySeed, DEFAULT_SEED, STAGES } from "../seed/apply.mjs";
import { startScratch } from "../seed/scratch.mjs";
import { SCENES, VIEWPORT, SHOT_SCALE } from "./story.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS_DIR = join(ROOT, "public", "demo");
const SHOTS_JSON = join(ROOT, "remotion", "demo", "shots.json");
const THEMES = ["light", "dark"];
const QUALITY = 0.86;

function parseArgs(argv) {
  const args = { scenes: null, themes: THEMES, port: 3100, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scenes") args.scenes = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--themes") args.themes = argv[++i].split(",").map((s) => s.trim());
    else if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg === "--list") args.list = true;
    else throw new Error(`demo: unknown option ${arg}`);
  }
  for (const id of args.scenes ?? []) {
    if (!SCENES.some((scene) => scene.id === id)) {
      throw new Error(`demo: no scene "${id}"; scenes are ${SCENES.map((s) => s.id).join(", ")}`);
    }
  }
  for (const theme of args.themes) {
    if (!THEMES.includes(theme)) throw new Error(`demo: themes are ${THEMES.join(", ")}`);
  }
  return args;
}

async function readShots() {
  try {
    return JSON.parse(await readFile(SHOTS_JSON, "utf8"));
  } catch {
    return { viewport: VIEWPORT, scale: SHOT_SCALE, shots: {} };
  }
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** PNG bytes to WebP, encoded by the browser so no image library is needed. */
async function toWebp(encoder, png) {
  const base64 = await encoder.evaluate(
    async ({ data, quality }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality });
      const out = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(text);
    },
    { data: png.toString("base64"), quality: QUALITY },
  );
  return Buffer.from(base64, "base64");
}

const round = (rect) =>
  rect && {
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
  };

/** Everything a typing overlay needs to set text exactly where the field does. */
async function measureField(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const px = (value) => Number.parseFloat(value) || 0;
    return {
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      padding: {
        top: px(style.paddingTop) + px(style.borderTopWidth),
        right: px(style.paddingRight) + px(style.borderRightWidth),
        bottom: px(style.paddingBottom) + px(style.borderBottomWidth),
        left: px(style.paddingLeft) + px(style.borderLeftWidth),
      },
      font: {
        family: style.fontFamily,
        size: px(style.fontSize),
        weight: style.fontWeight,
        lineHeight: style.lineHeight === "normal" ? px(style.fontSize) * 1.2 : px(style.lineHeight),
        letterSpacing: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
      },
      color: style.color,
      background: style.backgroundColor,
      multiline: element.tagName === "TEXTAREA",
    };
  });
}

/** Where the capture sits on screen: screen = capture * scale + offset. */
export async function measureCapture(page) {
  const image = page.locator("img.capture-frame-image").first();
  const info = await image.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, naturalWidth: element.naturalWidth };
  });
  return { x: info.x, y: info.y, scale: info.width / info.naturalWidth };
}

/** A seed mark's geometry, moved from capture pixels to the screen. */
export function markOnScreen(capture, mark) {
  const at = ({ x, y }) => ({ x: capture.x + x * capture.scale, y: capture.y + y * capture.scale });
  const box = ({ x, y }, width, height) => ({ ...at({ x, y }), width: width * capture.scale, height: height * capture.scale });
  switch (mark.kind) {
    case "pin":
      return { kind: "pin", tip: at(mark.tip) };
    case "rectangle":
      return { kind: "rectangle", rect: box(mark.rect, mark.rect.width, mark.rect.height) };
    case "circle":
      return { kind: "circle", rect: box(mark.circle, mark.circle.size, mark.circle.size) };
    default:
      return { kind: "arrow", start: at(mark.arrow.start), end: at(mark.arrow.end) };
  }
}

const roundDeep = (value) =>
  typeof value === "number"
    ? Math.round(value * 10) / 10
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)]))
      : value;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shots = await readShots();

  if (args.list) {
    for (const scene of SCENES) {
      const filmed = Object.values(shots.shots).filter((shot) => shot.scene === scene.id);
      const commits = [...new Set(filmed.map((shot) => shot.filmed.commit.replace(/\+$/, "")))];
      const later = commits.flatMap((commit) =>
        git("log", "--format=%h %s", `${commit}..HEAD`, "--", ...scene.sources).split("\n").filter(Boolean),
      );
      const when = filmed.map((shot) => shot.filmed.at).sort()[0]?.slice(0, 10) ?? "never";
      const status = filmed.length === 0 ? "not filmed" : later.length ? "stale" : "up to date";
      console.log(`${scene.id} (${filmed.length} shots, filmed ${when} at ${commits.join(", ") || "-"}): ${status}`);
      for (const line of [...new Set(later)]) console.log(`  changed since: ${line}`);
    }
    return;
  }

  const chosen = args.scenes ?? SCENES.map((scene) => scene.id);
  const first = SCENES.findIndex((scene) => chosen.includes(scene.id));
  const last = SCENES.findLastIndex((scene) => chosen.includes(scene.id));
  const run = SCENES.slice(first, last + 1);
  const startStage = run[0].from;
  if (!STAGES.includes(startStage)) throw new Error(`demo: scene ${run[0].id} starts at unknown stage ${startStage}`);

  const commit = git("rev-parse", "--short", "HEAD");
  const dirty = git("status", "--porcelain", "--", "app", "src").length > 0;
  const filmedAt = new Date().toISOString();
  const seed = JSON.parse(await readFile(DEFAULT_SEED, "utf8"));
  await mkdir(SHOTS_DIR, { recursive: true });

  const measuredThisRun = new Set();
  // Saved after every shot, so a run that fails partway keeps what it filmed.
  const save = async () => {
    shots.viewport = VIEWPORT;
    shots.scale = SHOT_SCALE;
    shots.shots = Object.fromEntries(Object.entries(shots.shots).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(SHOTS_JSON, `${JSON.stringify(shots, null, 2)}\n`);
  };
  const browser = await chromium.launch();
  const encoder = await browser.newPage();
  try {
    for (const theme of args.themes) {
      const scratch = await startScratch({ port: args.port });
      try {
        console.log(`demo: ${theme} — seeding to "${startStage}"`);
        const state = await applySeed({ browser, base: scratch.base, password: scratch.password, until: startStage });
        const editor = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: SHOT_SCALE,
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await editor.addInitScript((value) => {
          try {
            localStorage.setItem("pinata:theme", value);
          } catch {
            // Storage off: the color scheme above still applies.
          }
        }, theme);
        const page = await editor.newPage();
        const director = {
          base: scratch.base,
          password: scratch.password,
          seed,
          state,
          theme,
          browser,
          page,
          editor,
          contextOptions: { deviceScaleFactor: SHOT_SCALE, colorScheme: theme, reducedMotion: "reduce" },
          scene: null,
          /** Keep a piece of text a scene learned (the agent brief) for the video. */
          keep(name, value) {
            if (!chosen.includes(this.scene.id)) return;
            shots.text = { ...shots.text, [theme]: { ...shots.text?.[theme], [name]: value } };
          },
          async shoot(id, { targets = {}, fields = {}, capture = false, on = page } = {}) {
            if (!chosen.includes(this.scene.id)) return;
            await on.evaluate(() => document.fonts.ready);
            await on.waitForTimeout(350);
            const png = await on.screenshot({ type: "png", animations: "disabled" });
            const file = `${id}.${theme}.webp`;
            await writeFile(join(SHOTS_DIR, file), await toWebp(encoder, png));
            const measured = { scrollY: await on.evaluate(() => Math.round(window.scrollY)), targets: {}, fields: {} };
            for (const [name, locator] of Object.entries(targets)) {
              measured.targets[name] = round(await locator.boundingBox());
              if (!measured.targets[name]) throw new Error(`demo: ${id}: target "${name}" is not on screen`);
            }
            // A field is { locator, text }: where it is, and what the video types into it.
            for (const [name, { locator, text }] of Object.entries(fields)) {
              measured.fields[name] = { ...(await measureField(locator)), text };
            }
            if (capture) {
              measured.capture = roundDeep(await measureCapture(on));
              measured.marks = Object.fromEntries(
                seed.marks.map((mark) => [mark.key, roundDeep(markOnScreen(measured.capture, mark))]),
              );
            }
            const entry = shots.shots[id] ?? {};
            const { files: _files, filmed: _filmed, scene: _scene, ...previous } = entry;
            // Layout is the same in both themes: the first theme filmed in a
            // run measures it, and a later theme keeps those measures. A
            // field's colors are the one thing that differs, so each theme
            // adds its own.
            const again = measuredThisRun.has(id);
            const base = again ? previous : measured;
            const fieldsWithColors = Object.fromEntries(
              Object.entries(base.fields ?? {}).map(([name, field]) => {
                const { color, background, ...layout } = measured.fields[name] ?? field;
                return [
                  name,
                  {
                    ...(again ? field : layout),
                    colors: { ...(again ? field.colors : {}), [theme]: { color, background } },
                  },
                ];
              }),
            );
            shots.shots[id] = {
              scene: this.scene.id,
              files: { ...entry.files, [theme]: `/demo/${file}` },
              ...base,
              fields: fieldsWithColors,
              filmed: { at: filmedAt, commit: dirty ? `${commit}+` : commit },
            };
            measuredThisRun.add(id);
            await save();
            console.log(`demo:   ${id} (${theme})`);
          },
        };
        for (const scene of run) {
          director.scene = scene;
          console.log(`demo: ${theme} — ${scene.id}${chosen.includes(scene.id) ? "" : " (passing through)"}`);
          await scene.run(director);
        }
        await editor.close();
      } finally {
        await scratch.stop();
      }
    }
  } finally {
    await browser.close();
  }

  // A scene filmed in full that no longer takes a shot it once took: drop
  // the shot and its files, so nothing stale is left for the video to use.
  if (args.themes.length === THEMES.length) {
    for (const [id, shot] of Object.entries(shots.shots)) {
      if (!chosen.includes(shot.scene) || measuredThisRun.has(id)) continue;
      for (const file of Object.values(shot.files)) await rm(join(ROOT, "public", file), { force: true });
      delete shots.shots[id];
      console.log(`demo: removed ${id}, which ${shot.scene} no longer films`);
    }
  }
  await save();
  console.log(`demo: wrote ${SHOTS_JSON.replace(`${ROOT}/`, "")}`);
}

await main();
