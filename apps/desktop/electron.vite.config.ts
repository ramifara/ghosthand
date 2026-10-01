// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// electron-vite: main + engine host (ESM, Node), preload (one sandbox-safe CJS file), renderer (React).
// Only `dependencies` (playwright-core) stay external; every @ghosthand/* package and the rest of the
// devDependencies are bundled, so the packaged app ships almost no node_modules.
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, "src/main/main.ts"),
          "engine-host": resolve(import.meta.dirname, "src/engine-host/main.ts"),
        },
        // Explicit: Vite 8 (rolldown) does not pick up electron-vite 5's automatic externals.
        external: [
          "electron",
          /^electron\//,
          "playwright-core",
          /^playwright-core\//,
          ...builtinModules,
          /^node:/,
        ],
        output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      // A sandboxed preload can only require a few Electron modules: bundle everything into one file.
      externalizeDeps: false,
      rollupOptions: {
        input: { preload: resolve(import.meta.dirname, "src/preload/preload.ts") },
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    server: { host: "127.0.0.1", port: 5180, strictPort: false },
    build: {
      outDir: resolve(import.meta.dirname, "out/renderer"),
      rollupOptions: { input: resolve(import.meta.dirname, "src/renderer/index.html") },
    },
  },
});
