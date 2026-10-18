// The demo video's story, scene by scene, as the real product is driven
// through it (remotion/demo/README.md). Each scene starts from a seed stage
// (scripts/seed/apply.mjs), acts through the real UI, and calls
// `director.shoot(id, ...)` for every screen the video shows, naming the
// elements the composition needs to find on it: what the cursor moves to
// (targets), where text gets typed (fields), and where the capture sits on
// the canvas (capture). Run in order, each scene leaves the state the next
// one starts from; scripts/demo/film.mjs seeds the stage instead when it
// starts partway through.
//
// The words typed and the marks drawn come from the seed
// (scripts/seed/chickpea.json), the same notes the landing's example shows.
//
// Each scene lists the sources that draw its screens. `npm run demo:film --
// --list` reports a scene as stale once a commit after its filming touches
// one of them. The stylesheet is left out on purpose: almost every commit
// touches it, so a style change is for the eye, not the report.

import { dirname } from "node:path";
import { DEFAULT_SEED, importPage, signInEditor } from "../seed/apply.mjs";

/** The browser window every shot is taken in, in CSS pixels. */
export const VIEWPORT = { width: 1440, height: 900 };
/** Device pixels per CSS pixel in the saved shots, so the video can zoom in. */
export const SHOT_SCALE = 1.5;
/** The address the video shows for Pinata, in place of the scratch server's. */
export const SHOWN_ORIGIN = "https://yourpinata.dev";

/** Sign the editor in once per run, through the API as the dialog does. */
async function signIn(director) {
  director.headers ??= await signInEditor(director.editor, director.base, director.password);
  return director.headers;
}

/** The project the story works on, as the workspace's own API lists it. */
async function findProject(director) {
  const response = await director.editor.request.get(`${director.base}/api/projects`);
  const { projects } = await response.json();
  const project = projects.find((p) => p.title === director.seed.project.title);
  if (!project) throw new Error("demo: the story's project is missing");
  return project;
}

/**
 * Park the mouse where it hovers nothing, so no tooltip or hover lands in a
 * shot, and let go of keyboard focus on the canvas: after Enter saves a note
 * the canvas holds focus and draws its focus ring, which a viewer watching a
 * cursor would never see. Focus in a text field stays; it is part of typing.
 */
async function rest(page) {
  await page.mouse.move(4, 896);
  await page.evaluate(() => {
    if (document.activeElement?.closest(".capture-canvas")) document.activeElement.blur();
  });
}

/**
 * Keep new captures waiting: answer the browser's dispatch calls with the
 * quota outcome, as e2e/stub-dispatch.ts does. With server capture off
 * (scripts/seed/scratch.mjs) nothing else starts one, so the scratch server
 * never contacts the address being captured.
 */
async function holdCaptures(context) {
  await context.route("**/api/captures/*/dispatch", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "Too many captures are active or scheduled right now.", code: "quota-exceeded" }),
    }),
  );
}

/**
 * Show the product's own address where the scratch server's would appear:
 * the link fields print the page's origin, and the video should read
 * yourpinata.dev, not 127.0.0.1. Presentation only, just before a shot.
 */
async function dress(page, base) {
  await page.evaluate(
    ({ from, to }) => {
      for (const field of document.querySelectorAll("input, textarea")) {
        if (field.value.includes(from)) field.value = field.value.replaceAll(from, to);
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replaceAll(from, to);
      }
    },
    { from: base, to: SHOWN_ORIGIN },
  );
}

/** Where a capture point lands on screen right now. */
async function onScreen(page, point) {
  const box = await page.locator("img.capture-frame-image").first().evaluate((image) => {
    const rect = image.getBoundingClientRect();
    return { x: rect.x, y: rect.y, scale: rect.width / image.naturalWidth };
  });
  return { x: box.x + point.x * box.scale, y: box.y + point.y * box.scale };
}

/** Frame the capture to the page's width, so the pricing cards read at video size. */
async function fitWidth(page) {
  const image = page.locator("img.capture-frame-image").first();
  await image.waitFor();
  await image.evaluate((element) => element.decode());
  await page.getByRole("button", { name: "Zoom and fit" }).click();
  await page.getByRole("button", { name: "Fit width" }).click();
  await page.waitForTimeout(500);
  await rest(page);
}

/** Open the project's desktop capture on the editor's canvas. */
async function openCanvas(director) {
  const { page } = director;
  await page.goto(`${director.base}/pins`);
  await page.getByText(/^Desktop · Ready/).first().click();
  await fitWidth(page);
}

/** A press, a smooth pull, and a release, as a hand draws a shape. */
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/**
 * The composer's comment field, once the draft's nearby elements have
 * settled, attached to the element the seed names. The product picks the
 * closest element itself; when that is not the one the landing's example
 * shows (an arrow's head sits nearer the heading than the Pro plan), pick
 * it from the list the way an editor would.
 */
async function composer(page, mark) {
  const comment = page.getByRole("textbox", { name: "Comment" });
  await comment.waitFor();
  const chip = page.getByTestId("draft-choice");
  await page.waitForFunction(() => !document.querySelector("[data-testid='draft-choice']")?.textContent.includes("Looking"));
  const want = mark.element.text;
  if (!(await chip.textContent()).includes(want)) {
    const change = page.getByRole("button", { name: "Change" });
    await change.click();
    const list = page.locator(".panel-candidates");
    for (const picked of await list.locator("input[type=checkbox]:checked").all()) await picked.uncheck();
    await list.locator("label.panel-candidate", { hasText: want }).first().locator("input").check();
    await change.click();
    if (!(await chip.textContent()).includes(want)) throw new Error(`demo: could not attach "${want}"`);
  }
  await page.waitForTimeout(200);
  return comment;
}

/** Type a comment, save it with Enter, and wait for the panel to list it. */
async function saveComment(page, comment, body, label) {
  await comment.fill(body);
  await comment.press("Enter");
  await page.getByRole("button", { name: new RegExp(`^${label} ·`) }).first().waitFor();
}

/** What the product calls each kind of mark, as in "Box 4". */
const MARK_NAMES = { pin: "Pin", circle: "Circle", arrow: "Arrow", rectangle: "Box" };

/** A panel row for a mark, by its name ("Pin 1", "Circle 2", ...). */
const row = (page, label) => page.getByRole("button", { name: new RegExp(`^${label} ·`) }).first();

export const SCENES = [
  {
    id: "capture",
    title: "Capture the page",
    from: "empty",
    sources: [
      "src/components/new-project-page.tsx",
      "src/components/project-create-form.tsx",
      "src/components/editor-home.tsx",
      "src/components/project-overview.tsx",
      "src/components/capture-progress.tsx",
    ],
    async run(director) {
      const { page, seed } = director;
      const site = seed.pages[0];
      await holdCaptures(director.editor);
      await signIn(director);
      director.state.pages ??= {};
      await page.goto(`${director.base}/pins/new`);
      const name = page.getByLabel("Project name (optional)");
      const address = page.getByLabel("Root URL");
      const submit = page.getByRole("button", { name: "Create project" });
      await name.fill(seed.project.title);
      await address.click();
      await rest(page);
      await director.shoot("capture-form", { targets: { address, submit }, fields: { address: { locator: address, text: site.url } } });
      await address.fill(site.url);
      await rest(page);
      await director.shoot("capture-typed", { targets: { address, submit } });
      await submit.click();
      await page.waitForURL("**/pins**");
      await page.getByText("Capturing 1 of 2").waitFor();
      await rest(page);
      await director.shoot("capture-progress", {
        targets: { status: page.getByText("Capturing 1 of 2"), desktop: page.getByText("Desktop · Queued · v1") },
      });

      // The capture itself is the seed's copy of the page, imported the way
      // the extension sends one. The queued project is set aside first, so
      // the story goes on with version 1 of each capture, as a seeded start
      // does (a capture on the queued page would be version 2).
      const queued = await findProject(director);
      const archived = await director.editor.request.post(
        `${director.base}/api/projects/${queued.publicId}/archive`,
        { headers: await signIn(director) },
      );
      if (!archived.ok()) throw new Error(`demo: archiving the queued project failed with ${archived.status()}`);
      const entry = await importPage({
        browser: director.browser,
        context: director.editor,
        base: director.base,
        headers: await signIn(director),
        seedDir: dirname(DEFAULT_SEED),
        page: site,
        project: null,
        title: seed.project.title,
        key: (name) => `demo-${Date.now().toString(36)}-${name}`,
      });
      director.state.project = entry.project;
      delete entry.project;
      director.state.pages[site.key] = entry;
      await page.goto(`${director.base}/pins`);
      await page.getByText("Desktop · Ready").waitFor();
      await rest(page);
      await director.shoot("capture-ready", {
        targets: {
          status: page.getByText(/captures ready/),
          desktop: page.getByText(/^Desktop · Ready/).first(),
          mobile: page.getByText(/^Mobile · Ready/).first(),
        },
      });
    },
  },
  {
    id: "annotate",
    title: "Pin it where it happens",
    from: "captured",
    sources: [
      "src/components/project-workspace.tsx",
      "src/components/capture-canvas.tsx",
      "src/components/canvas-icons.tsx",
      "src/components/pin-composer.tsx",
      "src/components/pin-row.tsx",
      "src/lib/canvas",
    ],
    async run(director) {
      const { page, seed } = director;
      const [pin, circle, arrow, box] = seed.marks;
      await signIn(director);
      await openCanvas(director);
      await director.shoot("annotate-canvas", {
        capture: true,
        targets: { circleTool: page.getByRole("button", { name: "Draw a circle" }) },
      });

      // A pin: one click on the toggle, then the note.
      await page.mouse.click(...Object.values(await onScreen(page, pin.tip)));
      let comment = await composer(page, pin);
      await rest(page);
      await director.shoot("annotate-pin", { capture: true, fields: { comment: { locator: comment, text: pin.body } } });
      await comment.fill(pin.body);
      await comment.press("Enter");
      await row(page, "Pin 1").waitFor();
      await rest(page);
      await director.shoot("annotate-pin-saved", {
        capture: true,
        targets: { row: row(page, "Pin 1"), circleTool: page.getByRole("button", { name: "Draw a circle" }) },
      });

      // A circle: pick the tool, drag around the price, then the note.
      await page.getByRole("button", { name: "Draw a circle" }).click();
      await drag(
        page,
        await onScreen(page, circle.circle),
        await onScreen(page, { x: circle.circle.x + circle.circle.size, y: circle.circle.y + circle.circle.size }),
      );
      comment = await composer(page, circle);
      await rest(page);
      await director.shoot("annotate-circle", { capture: true, fields: { comment: { locator: comment, text: circle.body } } });
      await comment.fill(circle.body);
      await comment.press("Enter");
      await row(page, "Circle 2").waitFor();

      // An arrow and a box, the same way.
      await page.getByRole("button", { name: "Draw an arrow" }).click();
      await drag(page, await onScreen(page, arrow.arrow.start), await onScreen(page, arrow.arrow.end));
      await saveComment(page, await composer(page, arrow), arrow.body, "Arrow 3");
      await page.getByRole("button", { name: "Draw a box" }).click();
      await drag(
        page,
        await onScreen(page, box.rect),
        await onScreen(page, { x: box.rect.x + box.rect.width, y: box.rect.y + box.rect.height }),
      );
      await saveComment(page, await composer(page, box), box.body, "Box 4");
      // The header's counts catch up on the workspace's next refresh; open
      // the canvas again rather than wait for it.
      await openCanvas(director);
      await director.shoot("annotate-done", {
        capture: true,
        targets: {
          pin: row(page, "Pin 1"),
          circle: row(page, "Circle 2"),
          arrow: row(page, "Arrow 3"),
          box: row(page, "Box 4"),
        },
      });
    },
  },
  {
    id: "share",
    title: "Send one link",
    from: "marked",
    sources: [
      "src/components/project-workspace.tsx",
      "src/components/send-sheet.tsx",
      "src/components/founder-share.tsx",
      "src/components/capture-canvas.tsx",
      "src/components/pin-row.tsx",
    ],
    async run(director) {
      const { page } = director;
      await signIn(director);
      await openCanvas(director);
      const pill = page.getByRole("button", { name: "Send" });
      await director.shoot("share-canvas", { capture: true, targets: { pill } });
      await pill.click();
      await page.getByRole("tab", { name: "Person review" }).click();
      const create = page.getByRole("button", { name: "Create link" });
      await create.waitFor();
      await rest(page);
      await director.shoot("share-panel", { targets: { create } });
      await create.click();
      const field = page.locator("input[id^='founder-share-url-']");
      await field.waitFor();
      director.state.founderUrl = await field.inputValue();
      const copy = page.getByRole("button", { name: "Copy link" });
      await rest(page);
      await dress(page, director.base);
      await director.shoot("share-created", { targets: { copy, field } });
      await director.editor.grantPermissions(["clipboard-read", "clipboard-write"], { origin: director.base });
      await copy.click();
      await page.getByRole("button", { name: "Copied" }).waitFor();
      await rest(page);
      await dress(page, director.base);
      await director.shoot("share-copied", { targets: { copied: page.getByRole("button", { name: "Copied" }) } });
    },
  },
  {
    id: "founder",
    title: "The founder replies",
    from: "shared",
    sources: [
      "src/components/founder-view.tsx",
      "src/components/thread-view.tsx",
      "src/components/capture-canvas.tsx",
    ],
    async run(director) {
      const { seed, state } = director;
      const context = await director.browser.newContext({ viewport: VIEWPORT, ...director.contextOptions });
      await context.addInitScript((value) => {
        try {
          localStorage.setItem("pinata:theme", value);
        } catch {
          // Storage off: the color scheme still applies.
        }
      }, director.theme);
      try {
        const page = await context.newPage();
        await page.goto(state.founderUrl);
        await page.getByText("Viewing as founder").waitFor();
        await fitWidth(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
        const first = row(page, "Pin 1");
        await director.shoot("founder-open", { on: page, capture: true, targets: { pin: first } });
        await first.click();
        const field = page.getByRole("textbox", { name: "Reply as founder" });
        await field.waitFor();
        await fitWidth(page);
        // Bring the capture and the selection beside it into view, as the
        // founder would scroll to read the note in place.
        await page.evaluate(() => {
          const canvas = document.querySelector(".capture-canvas");
          window.scrollTo(0, window.scrollY + canvas.getBoundingClientRect().top - 72);
        });
        await page.waitForTimeout(300);
        await rest(page);
        const send = page.getByRole("button", { name: "Send reply" });
        const answer = seed.marks[0].replies.find((entry) => entry.author === "founder");
        await director.shoot("founder-selected", {
          on: page,
          capture: true,
          fields: { reply: { locator: field, text: answer.body } },
          targets: { send },
        });
        await field.fill(answer.body);
        await director.shoot("founder-typed", { on: page, capture: true, targets: { send } });
        await send.click();
        await page.locator(".thread").getByText(answer.body).first().waitFor();
        await rest(page);
        await director.shoot("founder-replied", { on: page, capture: true });

        // The founder's other answer, as the seed has it, so the editor
        // comes back to two replies whichever way the story got here.
        for (const [index, mark] of seed.marks.entries()) {
          if (index === 0) continue;
          for (const entry of mark.replies.filter((r) => r.author === "founder")) {
            await row(page, `${MARK_NAMES[mark.kind]} ${index + 1}`).click();
            await page.getByRole("textbox", { name: "Reply as founder" }).fill(entry.body);
            await page.getByRole("button", { name: "Send reply" }).click();
            await page.locator(".thread").getByText(entry.body).first().waitFor();
          }
        }
      } finally {
        await context.close();
      }
    },
  },
  {
    id: "reply",
    title: "See the reply",
    from: "replied",
    sources: [
      "src/components/project-workspace.tsx",
      "src/components/pin-row.tsx",
      "src/components/thread-view.tsx",
      "src/components/capture-canvas.tsx",
    ],
    async run(director) {
      const { page } = director;
      await signIn(director);
      await openCanvas(director);
      const first = row(page, "Pin 1");
      await director.shoot("reply-unread", { capture: true, targets: { pin: first } });
      await first.click();
      await page.getByText("founder (founder)").first().waitFor();
      await rest(page);
      await director.shoot("reply-open", { capture: true, targets: { pin: first } });
    },
  },
  {
    id: "agent",
    title: "Hand it to a coding agent",
    from: "replied",
    sources: [
      "src/components/project-workspace.tsx",
      "src/components/send-sheet.tsx",
      "src/components/agent-link.tsx",
      "src/lib/agent-link.ts",
      "src/lib/agent-brief.ts",
    ],
    async run(director) {
      const { page } = director;
      await signIn(director);
      await openCanvas(director);
      const pill = page.getByRole("button", { name: "Send" });
      await director.shoot("agent-canvas", { capture: true, targets: { pill } });
      await pill.click();
      const create = page.getByRole("button", { name: "Create link" });
      await create.waitFor();
      await rest(page);
      await director.shoot("agent-panel", { targets: { create } });
      await create.click();
      const field = page.locator("input[id^='agent-link-url-']");
      await field.waitFor();
      director.state.agentUrl = await field.inputValue();
      const copy = page.getByRole("button", { name: "Copy prompt" });
      await rest(page);
      await dress(page, director.base);
      await director.shoot("agent-created", { targets: { copy } });
      await director.editor.grantPermissions(["clipboard-read", "clipboard-write"], { origin: director.base });
      await copy.click();
      await page.getByRole("button", { name: "Copied" }).waitFor();
      await rest(page);
      await dress(page, director.base);
      await director.shoot("agent-copied", { targets: { copied: page.getByRole("button", { name: "Copied" }) } });
      // What the agent reads at that link, for the scene's last beat.
      const brief = await (await fetch(director.state.agentUrl)).text();
      director.keep("brief", brief.replaceAll(director.base, SHOWN_ORIGIN));
      director.keep("prompt", await page.locator("textarea[id^='agent-link-prompt-']").inputValue());
    },
  },
];
