// The popup (D131, D132): what this tab is, where its capture goes, and the
// two ways out — "Send to Pinata" when signed in, "Download file" always.
// The capture itself runs in the service worker, so the popup can close
// while it works; reopening it shows where the last capture got to.

import { listProjects, PinataError, signIn, signOut } from "./api.js";
import { capturableUrl } from "./capture.js";
import { normalizedAddress, pageAddress } from "./package.js";
import {
  DEFAULT_SERVER,
  readSettings,
  serverOrigin,
  signedIn,
  writeSettings,
} from "./settings.js";

/** The project select's value for "make a new project". */
const NEW_PROJECT = "__new";

/** How long a finished capture's status is still shown on reopening. */
const STATUS_FRESH_MS = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);

const state = {
  tab: null,
  settings: null,
  projects: [],
};

function showStatus(status) {
  const line = $("status");
  line.textContent = status ? status.message : "";
  line.dataset.state = status ? status.state : "";
  const link = $("status-link");
  if (status && status.link) {
    $("open-link").href = status.link;
    link.hidden = false;
  } else {
    link.hidden = true;
  }
  const working = status && status.state === "working";
  $("send").disabled = working || !capturable();
  $("download").disabled = working || !capturable();
}

function capturable() {
  return Boolean(state.tab && capturableUrl(state.tab.url));
}

function variants() {
  const chosen = [];
  if ($("desktop").checked) chosen.push("desktop");
  if ($("mobile").checked) chosen.push("mobile");
  return chosen;
}

/** The project page this tab's address already is, if any. */
function matchingPage(project) {
  const address = normalizedAddress($("address").value);
  if (!project || !address) return null;
  return project.pages.find((page) => page.normalizedUrl === address) ?? null;
}

function updatePageNote() {
  const value = $("project").value;
  $("new-project-row").hidden = value !== NEW_PROJECT;
  const note = $("page-note");
  if (value === NEW_PROJECT) {
    note.textContent = "Starts a new project with this page.";
    return;
  }
  const project = state.projects.find((candidate) => candidate.publicId === value);
  note.textContent = matchingPage(project)
    ? "Adds a new version of this page."
    : "Adds this address as a new page.";
}

function fillProjects() {
  const select = $("project");
  select.replaceChildren();
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.publicId;
    option.textContent = project.title;
    select.append(option);
  }
  const fresh = document.createElement("option");
  fresh.value = NEW_PROJECT;
  fresh.textContent = "New project…";
  select.append(fresh);

  // The project that already has this page, else the one this site went to
  // last time, else a new one.
  const byPage = state.projects.find((project) => matchingPage(project));
  let host = "";
  try {
    host = new URL($("address").value).host;
  } catch {
    host = "";
  }
  const remembered = state.settings.lastProjectByHost?.[host];
  const byHost = state.projects.find((project) => project.publicId === remembered);
  select.value = (byPage ?? byHost)?.publicId ?? NEW_PROJECT;
  try {
    $("project-title").placeholder = new URL($("address").value).hostname;
  } catch {
    $("project-title").placeholder = "Project name";
  }
  updatePageNote();
}

function showSignedOut(message) {
  $("account").textContent = "";
  $("sign-in").hidden = false;
  $("target").hidden = true;
  $("send").hidden = true;
  $("foot").hidden = true;
  $("server").value = state.settings.server || DEFAULT_SERVER;
  if (message) showStatus({ state: "error", message });
}

async function showSignedIn() {
  const host = new URL(state.settings.server).host;
  $("account").textContent = host;
  $("sign-in").hidden = true;
  $("target").hidden = false;
  $("send").hidden = false;
  $("foot").hidden = false;
  const expires = state.settings.expiresAt ? new Date(state.settings.expiresAt) : null;
  $("signed-in-as").textContent = expires
    ? `Signed in until ${expires.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "Signed in";
  $("page-note").textContent = "Loading projects…";
  try {
    state.projects = await listProjects();
    state.settings = await readSettings();
    fillProjects();
  } catch (error) {
    if (error instanceof PinataError && error.status === 401) {
      await writeSettings({ token: null, expiresAt: null });
      state.settings = await readSettings();
      showSignedOut("Your Pinata sign-in has ended. Sign in again.");
      return;
    }
    $("page-note").textContent =
      error instanceof Error ? error.message : "Pinata could not list your projects.";
  }
}

async function onSignIn(event) {
  event.preventDefault();
  const origin = serverOrigin($("server").value);
  if (!origin) {
    showStatus({ state: "error", message: "Type Pinata's address, like https://yourpinata.dev." });
    return;
  }
  // Talking to a Pinata other than the ones the extension ships with needs
  // the browser's permission, asked for while the click is still fresh.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    showStatus({ state: "error", message: "Pinata needs permission to reach that address." });
    return;
  }
  $("sign-in-button").disabled = true;
  showStatus({ state: "working", message: "Signing in…" });
  try {
    const session = await signIn(origin, $("password").value);
    await writeSettings({ server: origin, token: session.token, expiresAt: session.expiresAt });
    $("password").value = "";
    state.settings = await readSettings();
    showStatus(null);
    await showSignedIn();
  } catch (error) {
    showStatus({
      state: "error",
      message: error instanceof Error ? error.message : "Pinata could not sign you in.",
    });
  } finally {
    $("sign-in-button").disabled = false;
  }
}

async function onSignOut() {
  const { server, token } = state.settings;
  await writeSettings({ token: null, expiresAt: null });
  if (token) await signOut(server, token);
  state.settings = await readSettings();
  showStatus(null);
  showSignedOut();
}

async function start(action) {
  const chosen = variants();
  if (chosen.length === 0) {
    showStatus({ state: "error", message: "Choose Desktop, Mobile, or both." });
    return;
  }
  const url = pageAddress($("address").value.trim());
  if (!normalizedAddress(url)) {
    showStatus({ state: "error", message: "The page address must start with http:// or https://." });
    return;
  }
  let target = null;
  if (action === "send") {
    const value = $("project").value;
    if (value === NEW_PROJECT) {
      const title = $("project-title").value.trim();
      target = { newProject: title ? { title } : {} };
    } else {
      target = { project: value };
    }
  }
  const job = {
    action,
    tabId: state.tab.id,
    url,
    title: state.tab.title || "",
    variants: chosen,
    target,
  };
  showStatus({ state: "working", message: "Capturing… your tab will flicker while Pinata lays it out." });
  const answer = await chrome.runtime.sendMessage({ type: "capture", job });
  if (!answer || !answer.started) {
    showStatus({ state: "error", message: answer?.reason ?? "The capture could not start." });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "status") {
    showStatus(message.status);
    // After a send, the project it went to is in the list (and remembered
    // for this site), so a second send adds a version instead of making
    // another new project.
    if (message.status.state === "done" && message.status.link && signedIn(state.settings)) {
      void readSettings().then(async (settings) => {
        state.settings = settings;
        await showSignedIn();
      });
    }
    if (message.status.signedOut) {
      void writeSettings({ token: null, expiresAt: null }).then(async () => {
        state.settings = await readSettings();
        showSignedOut();
      });
    }
  }
  return false;
});

async function init() {
  state.settings = await readSettings();
  // `?tab=<id>` opens the popup for a given tab when it is loaded as a page
  // rather than from the toolbar (the end-to-end check does this); the
  // toolbar popup always captures the active tab.
  const named = Number(new URLSearchParams(location.search).get("tab"));
  const [tab] = Number.isInteger(named) && named > 0
    ? [await chrome.tabs.get(named).catch(() => undefined)]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab ?? null;
  $("tab-title").textContent = tab?.title || "This tab";
  $("address").value = tab?.url ? pageAddress(tab.url) : "";
  if (!capturable()) {
    $("tab-note").hidden = false;
    $("tab-note").textContent =
      "Chrome doesn't let extensions capture this kind of page. Open the page you want to capture.";
  }

  $("sign-in").addEventListener("submit", (event) => void onSignIn(event));
  $("sign-out").addEventListener("click", () => void onSignOut());
  $("project").addEventListener("change", updatePageNote);
  $("address").addEventListener("input", updatePageNote);
  $("send").addEventListener("click", () => void start("send"));
  $("download").addEventListener("click", () => void start("download"));

  if (signedIn(state.settings)) await showSignedIn();
  else showSignedOut();

  // A "working" status the service worker never finished (it was stopped
  // mid-capture) stops counting after two minutes, so the buttons come back.
  const { status } = await chrome.storage.session.get("status");
  const age = status ? Date.now() - status.at : Infinity;
  const fresh = status && age < (status.state === "working" ? 2 * 60 * 1000 : STATUS_FRESH_MS);
  showStatus(fresh ? status : null);
}

void init();
