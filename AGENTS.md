<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# AGENTS.md

Instructions for coding agents (and humans) working on GhostHand. `CLAUDE.md` is a symlink to this file.

## What this is

GhostHand is a computer-use agent. A fast decision model (TypeSafe Jev) picks each step from an element table built from the accessibility tree. Larger models plan, write text and judge. Every run is recorded and replayable. The full plan is [`docs/plan/AGENT_PLAN.md`](docs/plan/AGENT_PLAN.md); research notes are in [`docs/research/notes/`](docs/research/notes/); decisions are in [`docs/adr/`](docs/adr/).

## Stack

- Bun workspaces for install and scripts (`bunfig.toml`: hoisted linker). **Node 24 runtime** for engine, Playwright, CLI and Electron. Packages use ESM and `node:` APIs only, never `Bun.*` (the testbed server is the exception: Hono on Bun with `bun:sqlite`).
- TypeScript 7 (`tsgo -b` with project references), Biome 2, Vitest, `@playwright/test`, Zod v4, pino, OpenTelemetry, changesets.
- UI (testbed now, desktop in Phase 2): Vite 8, React 19, Tailwind v4, shadcn/ui, TanStack Query/Router, Zustand.

## Commands

| Command | What it does |
|---|---|
| `bun install` | Install all workspaces |
| `bun run check` | typecheck + lint + unit tests (must pass before every PR) |
| `bun run typecheck` / `lint` / `format` / `test` | Individual steps |
| `bun run test:e2e` | Playwright smoke tests against the testbed |
| `bun run dev:testbed` | Testbed on 127.0.0.1:4400 (app) and :4401 (control API) |
| `bun run ghosthand <args>` | Run the CLI from source |
| `bun run eval` | Run an eval suite |
| `bun run license:check` / `secrets:check` | CI guards |

## Where things are

- `packages/protocol`: Zod schemas and types for everything crossing a process boundary, plus the `Result` helpers. No runtime deps beyond Zod.
- `packages/core`: step loop, question builders, gates, budgets, stall detection. Pure logic behind interfaces.
- `packages/decision-typesafe`: `DecisionProvider` over `@typesafe-ai/sdk`. The only importer of that SDK.
- `packages/consultants`: Codex app-server consultant.
- `packages/driver-playwright`: the web `Computer` (browser detection, profiles, observe, act, settle, origin guard).
- `packages/recorder`: run folders, `events.jsonl`, screenshots, traces, SQLite index, replay reader.
- `packages/engine`: composition root (config, providers, run lifecycle). `apps/cli`: the `ghosthand` command.
- `apps/testbed/{server,web,e2e}` and `packages/testbed-kit`: the deterministic test app, task definitions and oracles. In dev, Vite serves the web app on 127.0.0.1:4400 and proxies `/api` to the Bun app API on 127.0.0.1:4410; the control API (`/reset`, `/seed/:name`, `/clock`, `/oracle/:task`, `/mail`, `/session`, `/state`, `/dump`) is on 127.0.0.1:4401. Server tests use `bun test` (`bun:sqlite` doesn't load under Vitest/Node); `bun run test` runs both. Tasks live in `packages/testbed-kit/src/tasks/`; oracles are pure functions over the DB snapshot that the server runs behind `GET /oracle/:task`. Fixture credentials are in `packages/testbed-kit/src/fixture-secrets.ts`.
- `scripts/`: probes that call paid APIs. Never run in CI.

Dependency direction: `protocol → core → {decision-typesafe, models, consultants, driver-playwright, knowledge, recorder, voice, qa} → engine → {cli, desktop, mcp, evals}`. Lower layers never import higher ones.

## Conventions

- kebab-case filenames; one concern per file; named exports only (no default exports, except where a tool requires one, e.g. config files); no `index.ts` barrels except each package's `src/index.ts`; no circular imports.
- Every package declares its own dependencies. Use `workspace:*` for internal packages and `catalog:` for shared external versions.
- Strict TS: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. `import type` for types. No `any`: use `unknown` and parse with Zod.
- Relative imports include the `.ts` extension.
- Expected failures return `Result<T, E>` (`ok()`/`err()` from `@ghosthand/protocol`) with `E` a discriminated union on `kind`. Throw only for programmer errors. Wrap third-party exceptions at the package boundary.
- Logging: `pino` child logger per package via `createLogger`; never log secrets; never enable the TypeSafe SDK `debug` level.
- Every source file starts with an SPDX header:
  `// SPDX-License-Identifier: AGPL-3.0-only` and `// Copyright (C) 2026 Rami Fara and GhostHand contributors`.
- Tests: `*.test.ts` next to sources; fixtures in `__fixtures__`; recorded model responses in `__recordings__`. Tests never call paid APIs or need secrets.

## Do

- Read the relevant research note before starting a task.
- Write a short ADR in `docs/adr/` when you make a decision the plan doesn't cover, and ask the user before building on it.
- Keep secrets as names (`[input:NAME]`); resolve values only in the driver at action time.
- Bind every dev server to `127.0.0.1`.

## Don't

- Paste or log secrets. Call `chatgpt.com/backend-api`. Bypass CLI permission prompts. Auto-acknowledge provider safety checks.
- Retry a mutating action. Treat a model's "done" as success (oracles and deterministic checks decide).
- Touch the T3 Code Tailscale route (`https://outpostone.tail19dab3.ts.net/` on 443) or `t3code.service`. Use Tailscale Funnel.
- Add a dependency with a disallowed license (GPL-2.0-only, SSPL, BSL, Elastic, non-commercial, closed SDKs such as `@anthropic-ai/claude-agent-sdk`).
