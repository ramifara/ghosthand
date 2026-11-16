<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Security policy

GhostHand drives a real browser with real credentials, so security bugs matter.

## Reporting

Please use [GitHub's private vulnerability reporting](https://github.com/ramifara/ghosthand/security/advisories/new) when it is enabled. If that option is unavailable, contact [the maintainer](https://github.com/ramifara) through a contact method listed on their profile to arrange a private channel. Do not post vulnerability details in a public issue. We aim to acknowledge reports within a week.

Include the affected version or commit, operating system, reproduction steps, impact and a minimal example with synthetic data. Never include real credentials, browser profiles or unredacted run recordings.

## Supported versions

GhostHand is under active development. Security fixes target the latest code on `main` and the newest release. Older releases have no maintained security backports.

## In scope

- Secrets reaching a model, a log, a screenshot, a recording or a recipe.
- Prompt injection from a web page that causes an action outside the user's task or origin allowlist.
- Bypasses of approvals, effect classes, origin guards or budgets.
- Electron issues involving IPC validation, navigation, CSP or fuses.

## Design rules

- Secrets live in Electron `safeStorage` or `~/.config/ghosthand/env` (0600). Models only see `[input:NAME]` placeholders.
- `bun run secrets:check` scans repository files and the configured run directories for registered secret values and common key formats. `bun run secrets:check --history` also scans Git blobs reachable from local refs. These checks cannot detect every kind of sensitive data; review screenshots, logs and recordings before sharing them.
- GhostHand never calls private ChatGPT endpoints, never bypasses CLI permission prompts and never auto-acknowledges provider safety checks.
