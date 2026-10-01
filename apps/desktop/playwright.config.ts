// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Electron smoke tests (Playwright `_electron`). They launch the built app from out/ with a hidden window
// and a throwaway userData folder, and skip when there is no display.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
});
