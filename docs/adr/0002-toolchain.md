<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0002. Toolchain: Bun workspaces, Node 24 runtime

- Status: accepted
- Date: 2026-10-01

## Context
We want fast monorepo DX. Playwright and Electron only officially support Node. See `docs/research/notes/monorepo-testbed.md`.

## Decision
- **Bun** installs and runs scripts (`bun.lock`, root `workspaces` + `catalog`, `bunfig.toml` with `linker = "hoisted"`, `trustedDependencies: ["electron", "esbuild"]`).
- **Node 24+** runs the engine, Playwright, the CLI, Vitest and Electron. Packages are ESM using `node:` APIs only. The testbed server runs on Bun (Hono + `bun:sqlite`).
- Internal packages are source-first: `exports` point at `src/index.ts`, so nothing is built in development. The CLI runs from source with Node's type stripping.
- TypeScript 7 (`tsgo -b`, project references), Biome 2 (lint and format), Vitest (root `projects` config), `@playwright/test` for e2e, changesets for versioning.

## Consequences
- `bun run` honours shebangs, so Node-only tools run on Node. Never use `bun --bun run`.
- If Bun causes friction (Electron packaging, Playwright), switching to pnpm is a one-day task. Decision point: end of Phase 0.
