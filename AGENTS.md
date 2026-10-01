<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# AGENTS.md

Instructions for coding agents (and humans) working on GhostHand. `CLAUDE.md` is a symlink to this file.

## What this is

GhostHand is a computer-use agent. A fast decision model (TypeSafe Jev) picks each step from an element table built from the accessibility tree. Larger models plan, write text and judge. Every run is recorded and replayable. The full plan is [`docs/plan/AGENT_PLAN.md`](docs/plan/AGENT_PLAN.md); research notes are in [`docs/research/notes/`](docs/research/notes/); decisions are in [`docs/adr/`](docs/adr/).

## Stack

- Bun workspaces for install and scripts (`bunfig.toml`: hoisted linker). **Node 24 runtime** for engine, Playwright, CLI and Electron. Packages use ESM and `node:` APIs only, never `Bun.*` (the testbed server is the exception: Hono on Bun with `bun:sqlite`).
- TypeScript 7 native compiler (`tsc -b` with project references; formerly tsgo), Biome 2, Vitest, `@playwright/test`, Zod v4, pino, OpenTelemetry, changesets.
- UI (testbed now, desktop in Phase 2): Vite 8, React 19, Tailwind v4, shadcn/ui, TanStack Query/Router, Zustand.

## Commands

| Command | What it does |
|---|---|
| `bun install` | Install all workspaces |
| `bun run check` | typecheck + lint + unit tests (must pass before every PR) |
| `bun run typecheck` / `lint` / `format` / `test` | Individual steps |
| `bun run test:e2e` | Playwright smoke tests against the testbed |
| `bun run dev:testbed` | Testbed on 127.0.0.1:4400 (app) and :4401 (control API) |
| `bun run dev:desktop` | Desktop app with Vite HMR (renderer on 127.0.0.1) |
| `bun run test:desktop` | Build the desktop app and run its Electron smoke tests (needs a display; the run test also needs the testbed) |
| `bun run dist:desktop` / `dist:desktop:appimage` | Unsigned installers into `apps/desktop/release/` (all targets for this OS / Linux AppImage only) |
| `bun run ghosthand <args>` | Run the CLI from source |
| `bun run eval` | Run an eval suite |
| `bun run license:check` / `secrets:check` | CI guards |

## Where things are

- `packages/protocol`: Zod schemas and types for everything crossing a process boundary, plus the `Result` helpers. No runtime deps beyond Zod.
- `packages/core`: step loop, question builders, gates, budgets, stall detection. Pure logic behind interfaces.
- `packages/decision-typesafe`: `DecisionProvider` over `@typesafe-ai/sdk`. The only importer of that SDK.
- `packages/consultants`: Codex app-server consultant and the Claude consultant (the user's own `claude` CLI, opt-in; ADR 0007).
- `packages/models`: AI SDK providers (OpenAI, Anthropic, Google, OpenRouter, local OpenAI-compatible), catalog, role chains, `VisionGrounder`.
- `packages/driver-playwright`: the web `Computer` (browser detection, profiles, observe, act, settle, origin guard).
- `packages/driver-desktop`: desktop `Computer`s over JSON-RPC hosts (Linux X11 sandbox and headless GNOME Wayland in Python/AT-SPI; Windows UIA in C#; macOS AX in Swift). Host-desktop drivers need `--allow-host-desktop`. See `docs/desktop-drivers.md`.
- `packages/recorder`: run folders, `events.jsonl`, screenshots, traces, SQLite index, replay reader.
- `packages/knowledge` (ADR 0011): `knowledge.sqlite` next to the run index with the app map and recipes (`ghosthand recipes list|show|export|remove`, `ghosthand map`; learn with `--learn`), and the React/TS source map extractor (`ghosthand sourcemap <dir> [--diff <base>]`; source-aware runs with `--source <dir>`). Screen fingerprints and the mode A/D executors live in `packages/core` (`screen-fingerprint.ts`, `mode-a.ts`, `mode-d.ts`, `vision.ts`).
- `packages/engine`: composition root (config, providers, run lifecycle). `apps/cli`: the `ghosthand` command.
- `apps/desktop`: the Electron app (ADR 0008). `src/main` (thin broker: window, IPC validation, settings, `safeStorage` secrets, ChatGPT sign-in), `src/preload` (one `window.ghosthand` bridge), `src/engine-host` (utilityProcess running the engine), `src/renderer` (React UI). The IPC contract is `packages/protocol/src/ipc.ts`. Electron tests are in `apps/desktop/e2e` (Playwright `_electron`, hidden window, skipped without a display).
- `apps/testbed/{server,web,e2e}` and `packages/testbed-kit`: the deterministic test app, task definitions and oracles. In dev, Vite serves the web app on 127.0.0.1:4400 and proxies `/api` to the Bun app API on 127.0.0.1:4410; the control API (`/reset`, `/seed/:name`, `/clock`, `/oracle/:task`, `/mail`, `/session`, `/state`, `/dump`) is on 127.0.0.1:4401. Server tests use `bun test` (`bun:sqlite` doesn't load under Vitest/Node); `bun run test` runs both. Tasks live in `packages/testbed-kit/src/tasks/`; oracles are pure functions over the DB snapshot that the server runs behind `GET /oracle/:task`. Fixture credentials are in `packages/testbed-kit/src/fixture-secrets.ts` (a secret named `*_TOTP` is a TOTP seed: typing it types the current code). Levels: L1–L3 (forms, tables, widgets), L4 under `/lab` (frames, with cross-origin content on 127.0.0.1:4402; shadow DOM; canvas; drag and drop; upload/download from `apps/testbed/fixtures/uploads`; infinite and virtualized lists; hover and context menus), L5 auth (TOTP, a public dev mailbox at `/mailbox?address=…`, password reset, session expiry, and a fake IdP on 127.0.0.1:4403), L6 robustness as variant flags (`latency`, `flaky`, `popups`, `layoutShift`, `ids`, `a11y`, `locale`, `theme`, `zoom`). `GHOSTHAND_TESTBED_PORT_OFFSET=100` moves every testbed port by 100 (4500/4501/4502/4503/4510), so a second testbed can run next to the default one; `eval --profile <name>` lets evals run side by side.
- `packages/qa` (QA mode: spec parser, preflight, judge, rubric, HTML report) and `packages/mcp` (MCP server on stdio, ADR 0006). QA specs for the testbed live in `apps/testbed/specs/` (format in its README); `ghosthand test <spec.md>` runs one, `ghosthand mcp` serves MCP. The testbed variant `bug=profile-title` plants a bug for specs to catch.
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
