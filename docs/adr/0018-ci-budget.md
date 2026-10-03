<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0018. CI budget: Linux on every change, macOS and Windows on demand

- Status: proposed
- Date: 2026-10-03

## Context

Three days into the month the repository had used 792 Linux, 134 Windows and 81 macOS runner minutes ($12.74 gross) and the account's Actions quota was exhausted; every job on `main` was then refused ("recent account payments have failed or your spending limit needs to be increased"), so no CI and no release could run. Measured per CI + release cycle (one push): macOS ≈ 4.1 min, Windows ≈ 6.7 min, Linux ≈ 9.4 min. GitHub weights macOS minutes 10× and Windows 2×, so one push cost about 63 Linux-equivalent minutes and a PR with three pushes and a merge about 250 of the 2,000 free ones. Two thirds of it came from the release workflow, which also ran on every pull request and after every merge (a four-platform installer matrix with two macOS runners), and from the macOS and Windows desktop-host jobs in CI, which rebuild Swift and .NET hosts nobody had touched. No job had a timeout: a hung Playwright or Electron test could run for six hours.

## Decision

- The release workflow runs only on a `v*` tag or by hand from `main`; never on pull requests or after a merge. Local builds (ADR 0014's notes) and the tag flow cover testing between releases.
- In CI, the macOS and Windows desktop-host jobs run only when `packages/driver-desktop/hosts/{macos,windows}/**`, the smoke script or the workflow itself changed (a `changes` job diffs against the PR base or the previous `main` commit), or when the workflow is started by hand with "hosts" ticked. The Linux jobs (check, e2e with the browser tests, the X11 container) run on every push and pull request.
- Every job has a `timeout-minutes` (5–20). Bun's install cache and Playwright's browser cache are restored by `bun.lock` hash.
- The Copilot pull-request reviewer (6.9 min of Linux runner time and 40 premium requests across two reviews) is a repository setting, not a workflow; it is for the owner to keep or turn off.

## Consequences

A typical push now costs about 10 Linux minutes and nothing on macOS or Windows; the month's quota covers roughly 200 pushes instead of 30. Host regressions on macOS and Windows surface only when those folders change or on a manual run; the Electron smoke tests still run on X11 in every CI run. Releases need a deliberate action, which also stops version numbers from advancing with every merge.
