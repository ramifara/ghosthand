<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Contributing to GhostHand

## Contributor License Agreement

GhostHand requires a CLA, a license grant rather than an assignment, so the maintainer can offer a commercial license alongside AGPL-3.0-only. Contributions remain available under AGPL-3.0-only. The planned signing service is [cla-assistant.io](https://cla-assistant.io).

The agreement and signing integration are not yet published. Until the maintainer links the agreement here and enables signing, outside contributions must not be merged. Opening a pull request does not sign a CLA.

## Local setup

Use Node 24 and Bun 1.3.11, matching CI. Fork the repository and clone your fork, then run:

```sh
bun install --frozen-lockfile
bun run check
bun run license:check
bun run secrets:check
```

Unit tests need no API keys and make no paid model calls. Live Linux desktop sandbox tests need Docker. To run the unit suite without that sandbox, use `GHOSTHAND_SKIP_SANDBOX_TESTS=1 bun run check`, as the main CI check job does. Browser tests use `bun run test:e2e` and need Playwright's Chromium, installed with `bunx playwright install chromium`.

See [README.md](README.md#setup) for the testbed and optional live agent credentials. Keep keys, run recordings, browser profiles and signing files out of commits. Recordings and screenshots may contain personal data even when registered secrets are masked.

## Bugs, ideas and questions

Use [GitHub issues](https://github.com/ramifara/ghosthand/issues) for reproducible bugs and proposed changes. Include the operating system, GhostHand version and steps to reproduce. Discuss large changes before implementing them. Follow [SECURITY.md](SECURITY.md) for vulnerabilities; keep exploit details and credentials out of public issues.

## Workflow

1. Read [`AGENTS.md`](AGENTS.md) and the ADRs in [`docs/adr/`](docs/adr/).
2. Pick a GitHub issue or plan task such as `P0-03`. Create a branch such as `feat/p0-03-protocol`. A git worktree is optional.
3. Run `bun run check` (typecheck, lint, tests) before pushing. CI also runs `license:check` and `secrets:check`.
4. Open a pull request with a [Conventional Commit](https://www.conventionalcommits.org) title (`feat(core): …`, `fix(driver-playwright): …`). One task per PR. Stacked PRs are fine. PRs are squash-merged.
5. Add a changeset (`bun changeset`) when a package's behaviour changes.

## Conventions

See [`AGENTS.md`](AGENTS.md#conventions). Use strict TypeScript, kebab-case filenames, named exports, typed `Result` errors at package boundaries, Zod schemas for anything crossing a process boundary, an SPDX header in every source file and tests next to sources.
