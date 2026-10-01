// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Browser tests launch Chrome/Chromium; startup is slow on CI runners and on a loaded machine.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ghosthand/driver-playwright",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
