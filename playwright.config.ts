import { defineConfig, devices } from "@playwright/test";

const localBrowser = process.env.JOBPILOT_E2E_SYSTEM_CHROME ? { channel: "chrome" as const } : {};
const productionBuild = Boolean(process.env.CI || process.env.JOBPILOT_E2E_PRODUCTION);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: productionBuild
      ? "npm run db:setup && next start --hostname 127.0.0.1"
      : "npm run db:setup && npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...localBrowser } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], ...localBrowser } },
  ],
});
