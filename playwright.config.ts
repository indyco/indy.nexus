import { defineConfig } from "@playwright/test";
import path from "path";

const PLAYWRIGHT_DATA_DIR = path.join(__dirname, "data-playwright");

export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: "http://localhost:3099",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],

  /* Start the app in test mode before running tests */
  webServer: {
    command: "node server.js --test",
    url: "http://localhost:3099/api/health",
    reuseExistingServer: false,
    timeout: 10000,
    env: { PORT: "3099", DATA_DIR: PLAYWRIGHT_DATA_DIR },
  },
});
