<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# GhostHand™

**GhostHand, a Jev CUA.** An open-source, general-purpose computer-use agent in TypeScript and Electron. Give it a task (or a QA spec) and a URL, and it does the work in a real browser. A fast decision model, TypeSafe Jev, makes each step's choice in roughly 0.2–0.5 s. Larger models are consulted only to plan, write text, give hints, judge visually or handle unknown UIs. Every session is recorded and can be replayed.

Status: Phase 0 (foundations and a working Jev-first loop on the bundled testbed). See [`docs/plan/AGENT_PLAN.md`](docs/plan/AGENT_PLAN.md).

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

Optional: the Codex CLI, signed in, for planning (`codex login`).

## Repository layout

- `packages/*`: the engine libraries (`@ghosthand/protocol`, `core`, `decision-typesafe`, `driver-playwright`, `recorder`, …).
- `apps/cli`: the `ghosthand` command. `apps/testbed`: a deterministic web app the agent is measured against. `apps/desktop`: the Electron app (Phase 2).
- `docs/`: architecture, ADRs, plan, research notes, phase reports. Contributors and coding agents start with [`AGENTS.md`](AGENTS.md).

## License

GhostHand is licensed under [AGPL-3.0-only](LICENSE). You may use, modify, sell and host it. If you distribute it, or offer a modified version over a network, you must share your source under AGPL-3.0. Want to ship it under other terms? Contact the maintainer about a commercial license. Contributions require signing the [CLA](CONTRIBUTING.md#contributor-license-agreement). The name is covered by [TRADEMARKS.md](TRADEMARKS.md).
