// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Unit tests for main, engine host and renderer logic. Renderer component tests opt into jsdom with a
// `// @vitest-environment jsdom` comment. The Electron smoke test lives in e2e/ and runs under
// Playwright (`bun run --filter @ghosthand/desktop test:smoke`), not Vitest.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "@ghosthand/desktop",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
