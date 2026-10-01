<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Security policy

GhostHand drives a real browser with real credentials, so security bugs matter.

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab) rather than a public issue. Expect an acknowledgement within a week.

## In scope

- Secrets reaching a model, a log, a screenshot, a recording or a recipe.
- Prompt injection from a web page that causes an action outside the user's task or origin allowlist.
- Bypasses of approvals, effect classes, origin guards or budgets.
- Electron issues (IPC validation, navigation, CSP, fuses) once the desktop app ships.

## Design rules

- Secrets live in Electron `safeStorage` or `~/.config/ghosthand/env` (0600). Models only see `[input:NAME]` placeholders.
- Every run folder, log and the repo are checked for registered secret values (`bun run secrets:check`).
- GhostHand never calls private ChatGPT endpoints, never bypasses CLI permission prompts and never auto-acknowledges provider safety checks.
