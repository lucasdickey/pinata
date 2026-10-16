import { expect, test } from "@playwright/test";
import { localEnvGate, requireLocalEnvValue } from "./local-env";

const editorEnv = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
]);

const projects = [
  {
    projectId: "history-1",
    publicId: "history-one",
    title: "First review",
    rootUrl: "https://example.com/",
    pages: [],
    counts: { pages: 0, attempts: 0, ready: 0, failed: 0, inProgress: 0 },
  },
  {
    projectId: "history-2",
    publicId: "history-two",
    title: "Second review",
    rootUrl: "https://example.org/",
    pages: [],
    counts: { pages: 0, attempts: 0, ready: 0, failed: 0, inProgress: 0 },
  },
];

test("Back and Forward preserve history and the issuing project's one-time result", async ({
  page,
}) => {
  test.skip(!editorEnv.ready, editorEnv.reason);
  await page.route("**/api/projects", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { projects } })
      : route.continue(),
  );
  await page.route("**/api/projects/history-*/annotations", (route) =>
    route.fulfill({ json: { annotations: [] } }),
  );
  let finishIssue!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishIssue = resolve;
  });
  await page.route("**/api/projects/history-one/agent-link", async (route) => {
    if (route.request().method() === "POST") {
      await pending;
      await route.fulfill({
        status: 201,
        json: { link: { state: "active", version: 1 }, path: "/a/one-time-test" },
      });
    } else {
      await route.fulfill({ json: { link: { state: "none", version: 0 } } });
    }
  });
  await page.goto("/#editor-login");
  const login = page.getByRole("dialog", { name: "Editor sign in" });
  await login.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await page.getByRole("button", { name: "Show projects" }).click();
  await page.getByRole("button", { name: "First review", exact: true }).click();
  await expect(page).toHaveURL(/project=history-one$/);
  await page.evaluate(() => {
    history.replaceState({ ...history.state, marker: "first" }, "", location.href);
  });
  await page.getByRole("button", { name: "Show projects" }).click();
  await page.getByRole("button", { name: "Second review", exact: true }).click();
  await expect(page).toHaveURL(/project=history-two$/);
  await page.evaluate(() => {
    history.replaceState({ ...history.state, marker: "second" }, "", location.href);
  });
  await page.goBack();
  await expect(page).toHaveURL(/project=history-one$/);
  await expect(page.getByTestId("project-title")).toHaveText("First review");
  expect(await page.evaluate(() => history.state)).toMatchObject({ marker: "first" });
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Send First review" })).toHaveAttribute(
    "aria-busy",
    "true",
  );

  await page.goForward();
  await expect(page).toHaveURL(/project=history-two$/);
  expect(await page.evaluate(() => history.state)).toMatchObject({ marker: "second" });
  await expect(page.getByTestId("project-title")).toHaveText("Second review");
  await expect(page.getByRole("dialog", { name: "Send First review" })).toBeVisible();
  finishIssue();
  await expect(page.getByLabel(/Agent link \(shown once/)).toHaveValue(
    "http://127.0.0.1:3100/a/one-time-test",
  );
  await page.goBack();
  await expect(page.getByTestId("project-title")).toHaveText("First review");
  await expect(page.getByLabel(/Agent link \(shown once/)).toHaveValue(
    "http://127.0.0.1:3100/a/one-time-test",
  );
  await page.goForward();
  await expect(page.getByTestId("project-title")).toHaveText("Second review");
  await expect(page.getByLabel(/Agent link \(shown once/)).toHaveValue(
    "http://127.0.0.1:3100/a/one-time-test",
  );
  await page.getByRole("button", { name: "Close Send" }).click();
  await expect(page.getByTestId("project-title")).toHaveText("Second review");
  await page.goBack();
  await expect(page).toHaveURL(/project=history-one$/);
  await expect(page.getByTestId("project-title")).toHaveText("First review");
  expect(await page.evaluate(() => history.state)).toMatchObject({ marker: "first" });
  await page.goForward();
  await expect(page).toHaveURL(/project=history-two$/);
  await expect(page.getByTestId("project-title")).toHaveText("Second review");
  expect(await page.evaluate(() => history.state)).toMatchObject({ marker: "second" });
});
