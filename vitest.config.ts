// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/cli", "apps/testbed/web"],
    passWithNoTests: true,
    coverage: { provider: "v8", reporter: ["text-summary", "lcov"] },
  },
});
