import { defineConfig, devices } from "@playwright/test";

// The production build is a validate-gate stage ahead of this one, so e2e runs
// against `next start` on the only sanctioned address.
export default defineConfig({
  testDir: "e2e",
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  // Run-scoped store rows are deleted here, after every worker's last page
  // has closed — never in a spec's afterAll, where a sibling worker's page
  // can still be observing them (e2e/run-cleanup.ts explains the race).
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    // Server continuation off (D076): the production server under test must
    // not start real captures behind the browser's back when a spec creates
    // a project; the client fallback driver and e2e/stub-dispatch.ts then
    // behave exactly as before. Local and test only, never a deployment.
    env: { ...(process.env as Record<string, string>), PINATA_SERVER_CAPTURE: "off" },
  },
});
