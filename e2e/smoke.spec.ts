import { expect, test } from "@playwright/test";

test("home page renders the product identity", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/pinata/);
  await expect(page.getByRole("heading", { level: 1, name: "pinata" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
