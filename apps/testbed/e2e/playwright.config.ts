// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Starts the testbed (Bun server + Vite) and runs the smoke tests serially: all tests share one DB.
// Locally this uses the installed Chrome; CI uses Playwright's Chromium.
import { APP_ORIGIN, CONTROL_ORIGIN } from "@ghosthand/testbed-kit/fixtures";
import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: 0,
  reporter: ci ? [["list"], ["github"]] : "list",
  use: {
    baseURL: APP_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: ci ? "chromium" : "chrome",
      use: { ...devices["Desktop Chrome"], ...(ci ? {} : { channel: "chrome" }) },
    },
  ],
  webServer: [
    {
      command: "bun run start",
      cwd: "../server",
      url: `${CONTROL_ORIGIN}/health`,
      reuseExistingServer: !ci,
      stdout: "pipe",
      timeout: 30_000,
    },
    {
      command: "bun run dev",
      cwd: "../web",
      url: APP_ORIGIN,
      reuseExistingServer: !ci,
      stdout: "pipe",
      timeout: 60_000,
    },
  ],
});
