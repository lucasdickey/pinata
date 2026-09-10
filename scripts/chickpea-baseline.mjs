#!/usr/bin/env node
// Direct-browser baseline for the Chickpea capture targets (VAL-CAPTURE-011).
//
// Immediately before a production capture run, this script drives a real
// Chromium (Playwright's bundled browser, a devDependency) at the two standard
// viewports over the ordered Chickpea URL array and records, per URL and
// device: requested/final URL, top heading, a below-fold landmark, the
// terminal footer/policy landmark, document height, the mobile header/menu
// state (including the labels hidden inside the closed mobile menu), and any
// currently animated regions. The production smoke script then checks the
// captured manifests against this same-run baseline.
//
// Read-only against chickpea.co: navigation and scrolling only, never form
// submission or consequential clicks.
//
// Usage:
//   node scripts/chickpea-baseline.mjs [output-path]
// Default output: /tmp/pinata-chickpea-baseline.json

import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const URLS = [
  "https://chickpea.co/",
  "https://chickpea.co/pricing",
  "https://chickpea.co/about",
  "https://chickpea.co/privacy",
];

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Scroll the full document so lazy content mounts, then return to top. */
async function scrollOut(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

/** The structural record for one URL in one browsing context. */
async function observe(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const topHeading = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    return h1 ? h1.textContent.trim().slice(0, 120) : null;
  });
  await scrollOut(page);
  return page.evaluate(
    ({ requestedUrl, finalUrl, heading }) => {
      const text = (el) => (el ? el.textContent.trim().replace(/\s+/g, " ").slice(0, 120) : null);
      const fold = window.innerHeight;
      const headings = [...document.querySelectorAll("h2, h3")].map((el) => ({
        text: text(el),
        top: el.getBoundingClientRect().top + window.scrollY,
      }));
      const belowFold = headings.find((h) => h.top > fold && h.text) ?? null;
      const footer = document.querySelector("footer");
      const lastHeading = headings.length > 0 ? headings[headings.length - 1] : null;
      const animated = [...document.querySelectorAll("*")].filter((el) => {
        const style = getComputedStyle(el);
        return style.animationName !== "none" && style.animationPlayState === "running";
      });
      const animatedRegions = animated.slice(0, 8).map((el) => ({
        tag: el.tagName.toLowerCase(),
        hint: (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(" ").slice(0, 80),
      }));
      // Mobile menu state: a closed <details> hides its descendant links;
      // record their labels so the capture manifest can be checked for their
      // ABSENCE, plus the header landmark that must stay visible.
      const detailsState = [...document.querySelectorAll("details")].map((el) => ({
        open: el.open,
        summary: text(el.querySelector("summary")),
        hiddenLinkLabels: el.open
          ? []
          : [...el.querySelectorAll("a")].map((a) => text(a)).filter(Boolean).slice(0, 12),
      }));
      const header = document.querySelector("header");
      return {
        requestedUrl,
        finalUrl,
        status: undefined,
        topHeading: heading,
        belowFoldLandmark: belowFold ? belowFold.text : null,
        terminalLandmark: text(footer) ?? (lastHeading ? lastHeading.text : null),
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        headerText: text(header),
        details: detailsState,
        animatedRegionCount: animated.length,
        animatedRegions,
      };
    },
    { requestedUrl: url, finalUrl: response?.url() ?? url, heading: topHeading },
  );
}

async function main() {
  const output = process.argv[2] ?? "/tmp/pinata-chickpea-baseline.json";
  const browser = await chromium.launch();
  const record = { startedAt: new Date().toISOString(), urls: {} };
  try {
    const desktop = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 1,
    });
    const mobile = await browser.newContext({
      viewport: MOBILE,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    for (const url of URLS) {
      const desktopPage = await desktop.newPage();
      const desktopObs = await observe(desktopPage, url);
      await desktopPage.close();
      const mobilePage = await mobile.newPage();
      const mobileObs = await observe(mobilePage, url);
      await mobilePage.close();
      record.urls[url] = { desktop: desktopObs, mobile: mobileObs };
      console.log(
        `baseline ${url}: desktop h=${desktopObs.documentHeight} heading=${JSON.stringify(desktopObs.topHeading)} | mobile h=${mobileObs.documentHeight} details=${mobileObs.details.length} animated=${mobileObs.animatedRegionCount}`,
      );
    }
  } finally {
    await browser.close();
  }
  record.finishedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(record, null, 2));
  console.log(`baseline written to ${output}`);
}

await main();
