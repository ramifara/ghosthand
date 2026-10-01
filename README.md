<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# GhostHand™

**GhostHand, a Jev CUA.** An open-source, general-purpose computer-use agent in TypeScript and Electron. Give it a task (or a QA spec) and a URL, and it does the work in a real browser. A fast decision model, TypeSafe Jev, makes each step's choice in roughly 0.2–0.5 s. Larger models are consulted only to plan, write text, give hints, judge visually or handle unknown UIs. Every session is recorded and can be replayed.

Status: Phases 0, 1, 2, 4, 5 and 6 are built; Phase 1 acceptance is met with real Jev (L1–L3 90/90, median step 742 ms, $0.00034 per step). Phases 3 and 7 are in progress. Reports: [`docs/reports/`](docs/reports/). Plan: [`docs/plan/AGENT_PLAN.md`](docs/plan/AGENT_PLAN.md).

## Setup

Requirements: [Bun](https://bun.com) 1.3+, Node 24+, and an installed Chrome, Edge or Brave (Playwright's Chromium is downloaded only if none is found).

```sh
bun install          # installs all workspaces (hoisted layout)
bun run check        # typecheck + lint + unit tests
bun run dev:testbed  # testbed app on 127.0.0.1:4400, control API on 127.0.0.1:4401
```

To run the agent you also need a TypeSafe API key in `~/.config/ghosthand/env` (mode 0600):

```sh
mkdir -p ~/.config/ghosthand
printf 'TYPESAFE_API_KEY=...\n' > ~/.config/ghosthand/env
chmod 600 ~/.config/ghosthand/env
bun run ghosthand doctor
bun run ghosthand run --url http://127.0.0.1:4400 --task l1-update-profile
```

Optional: the Codex CLI, signed in, for planning and writer hand-offs (`codex login`); `OPENAI_API_KEY` (or Anthropic/Google/OpenRouter keys) in the same env file for the models layer and vision. `./scripts/set-jev-key.sh` writes the TypeSafe key with a hidden prompt.

## Using it

```sh
bun run ghosthand run --url https://example.com "find the pricing page and tell me the cheapest plan"
bun run ghosthand run --task l2-orders-delete-row --headless        # a testbed task, graded by its oracle
bun run ghosthand replay <runId>                                   # mode A: no decision calls, heals moved targets
bun run ghosthand export <runId> --out flow.spec.ts                # Playwright test from a recorded run
bun run ghosthand eval --suite l1-l3 --n 5 --headless              # pass rates, step timing split, cost
bun run ghosthand test apps/testbed/specs/profile.md --runs 5      # QA mode: Markdown spec → scored HTML report
bun run ghosthand mcp                                              # MCP server on stdio (run_task, run_spec, ...)
bun run ghosthand voice transcribe note.wav                        # local Moonshine speech-to-text
bun run dev:desktop                                                # the Electron app
```

## Repository layout

- `packages/*`: the engine libraries (`@ghosthand/protocol`, `core`, `decision-typesafe`, `driver-playwright`, `recorder`, …).
- `apps/cli`: the `ghosthand` command. `apps/testbed`: a deterministic web app the agent is measured against. `apps/desktop`: the Electron app (Phase 2).
- `docs/`: architecture, ADRs, plan, research notes, phase reports. Contributors and coding agents start with [`AGENTS.md`](AGENTS.md).

## License

GhostHand is licensed under [AGPL-3.0-only](LICENSE). You may use, modify, sell and host it. If you distribute it, or offer a modified version over a network, you must share your source under AGPL-3.0. Want to ship it under other terms? Contact the maintainer about a commercial license. Contributions require signing the [CLA](CONTRIBUTING.md#contributor-license-agreement). The name is covered by [TRADEMARKS.md](TRADEMARKS.md).
