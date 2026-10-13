import { expect, test } from "@playwright/test";

const origin = "https://yourpinata.dev";
const description = "pin + annotation + at ya — directional feedback on public websites";
const publicPaths = [
  "/",
  "/walkthrough",
  "/reqs",
  "/reqs/architecture",
  "/reqs/milestones",
  "/reqs/decisions",
  "/reqs/evals",
];

test("anonymous landing exposes same-origin search and social metadata", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", origin);
  for (const [property, content] of [
    ["og:title", "Pinata"],
    ["og:description", description],
    ["og:url", origin],
    ["og:type", "website"],
  ]) {
    await expect(page.locator(`meta[property="${property}"]`)).toHaveAttribute("content", content);
  }
  for (const [name, content] of [
    ["twitter:card", "summary_large_image"],
    ["twitter:title", "Pinata"],
    ["twitter:description", description],
  ]) {
    await expect(page.locator(`meta[name="${name}"]`)).toHaveAttribute("content", content);
  }

  const image = `${origin}/illustrations/hero.png`;
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", image);
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", image);
  const imageResponse = await page.request.get("/illustrations/hero.png");
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toContain("image/png");

  await page.goto("/walkthrough");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.goto("/f/discovery-test");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test("robots and sitemap expose only public routes", async ({ request }) => {
  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.status()).toBe(200);
  const robots = await robotsResponse.text();
  expect(robotsResponse.headers()["content-type"]).toContain("text/plain");
  for (const path of ["/", "/walkthrough", "/reqs"]) {
    expect(robots).toContain(`Allow: ${path}\n`);
  }
  for (const path of ["/f/", "/a/", "/pins", "/api/"]) {
    expect(robots).toContain(`Disallow: ${path}\n`);
  }
  expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  expect(sitemapResponse.headers()["content-type"]).toContain("application/xml");
  const sitemap = await sitemapResponse.text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(urls).toEqual(publicPaths.map((path) => new URL(path, origin).href));
  for (const path of ["/f/", "/a/", "/pins", "/api/"]) {
    expect(sitemap).not.toContain(`${origin}${path}`);
  }
});

test("agent discovery lists public entry points without capability links", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const body = await response.text();
  expect(body).toContain("Pinata");
  for (const path of ["/", "/walkthrough", "/reqs"]) {
    expect(body).toContain(new URL(path, origin).href);
  }
  expect(body).not.toMatch(/\/(?:f|a|pins|api)\//);

  for (const path of ["/f/discovery-test", "/a/discovery-test"]) {
    const privateResponse = await request.get(path);
    expect(privateResponse.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  }
});
