<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Contributing to GhostHand

## Contributor License Agreement

Contributions are accepted under a CLA (Apache ICLA style, a license grant, not an assignment), managed by [cla-assistant.io](https://cla-assistant.io). The CLA lets the maintainer offer GhostHand under a commercial license as well as AGPL-3.0. Every contribution will always remain available under AGPL-3.0. The bot asks you to sign on your first pull request.

## Workflow

1. Read [`AGENTS.md`](AGENTS.md) and the ADRs in [`docs/adr/`](docs/adr/).
2. Pick a task (plan IDs such as `P0-03`, or a GitHub issue). Work in a git worktree on a branch named `<type>/<task-id>-<slug>`, for example `feat/p0-03-protocol`.
3. Run `bun run check` (typecheck, lint, tests) before pushing. CI also runs `license:check` and `secrets:check`.
4. Open a pull request with a [Conventional Commit](https://www.conventionalcommits.org) title (`feat(core): …`, `fix(driver-playwright): …`). One task per PR. Stacked PRs are fine. PRs are squash-merged.
5. Add a changeset (`bun changeset`) when a package's behaviour changes.

## Conventions

See [`AGENTS.md`](AGENTS.md#conventions). In short: strict TypeScript, kebab-case filenames, named exports only, typed `Result` errors at package boundaries, Zod schemas for anything crossing a process boundary, SPDX header in every source file, tests next to sources.
