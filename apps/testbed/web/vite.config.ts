// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Vite serves the app on 127.0.0.1:4400 and proxies `/api` to the Bun app API on 127.0.0.1:4410,
// so the browser sees one origin and the session cookie is first-party.
import { API_PORT, APP_PORT } from "@ghosthand/testbed-kit/fixtures";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const proxy = { "/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: APP_PORT, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: APP_PORT, strictPort: true, proxy },
  test: { include: ["src/**/*.test.ts"] },
});
