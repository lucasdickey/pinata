import { defineConfig, devices } from "@playwright/test";

// The production build is a validate-gate stage ahead of this one, so e2e runs
// against `next start` on the only sanctioned address.
export default defineConfig({
  testDir: "e2e",
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
