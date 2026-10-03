<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# GhostHand™

<img src="assets/brand/png/ghosthand-128.png" alt="GhostHand" width="96" height="96" />

**GhostHand, a Jev CUA.** An open-source, general-purpose computer-use agent in TypeScript and Electron. Give it a task (or a QA spec) and a URL, and it does the work in a real browser. A fast decision model, TypeSafe Jev, makes each step's choice in roughly 0.2–0.5 s. Larger models are consulted only to plan, write text, give hints, judge visually or handle unknown UIs. Every session is recorded and can be replayed.

Status: all plan phases (0–7) are built. Phase 1 acceptance is met with real Jev (L1–L3 90/90, median step 742 ms, $0.00034 per step); L4–L6 tasks that need no vision pass 105/105; desktop drivers run on Linux X11 and headless GNOME Wayland. Vision modes and the Windows driver still need live verification. Reports: [`docs/reports/`](docs/reports/). Plan: [`docs/plan/AGENT_PLAN.md`](docs/plan/AGENT_PLAN.md).

## Download the desktop app

Get the newest installers from [GitHub Releases](https://github.com/ramifara/ghosthand/releases/latest): Linux x64 `.AppImage` or `.deb`, Windows x64 `.exe`, and macOS `.dmg` for Apple Silicon or Intel.

Releases are built on demand (ADR 0018): push a `vMAJOR.MINOR.PATCH` tag, or run the release workflow from `main` in the Actions tab (its version is the desktop package's major/minor plus the run number). CI on pull requests runs on Linux only; the macOS and Windows desktop-host jobs run when their sources change or when the workflow is started by hand with "hosts" ticked. macOS runner minutes cost ten times Linux ones, so this keeps the free Actions quota for the month.

**Signed macOS builds** (ADR 0019): `bun run dist:desktop:mac-signed` builds the app, signs it with the Developer ID under the hardened runtime, notarizes it with Apple and staples the ticket, from any OS (it uses [`rcodesign`](https://github.com/indygreg/apple-platform-rs); set `RCODESIGN` to its path if it is not on `PATH`). It needs the signing files in `~/.config/ghosthand/signing/` (see the ADR); a signed build opens with a double-click.

Builds without those files (and Windows builds) are not signed with an Apple Developer ID or a Windows code-signing certificate, so the first launch needs one extra step:

- **macOS**: Gatekeeper blocks the app once. Open **System Settings → Privacy & Security**, scroll to the "GhostHand was blocked" message and press **Open Anyway**; or right-click the app and choose **Open**; or run `xattr -dr com.apple.quarantine /Applications/GhostHand.app`. The app does not use the Keychain (an unsigned app would be asked for your password on every launch); API keys are encrypted with a key kept in `~/Library/Application Support/GhostHand/`.
- **Windows**: SmartScreen shows "Windows protected your PC". Press **More info → Run anyway**.

Keys entered in Setup → Providers are used by every run. On macOS and Linux the app also reads `~/.config/ghosthand/env`, and it finds the Codex and Claude CLIs on your login shell's PATH (Homebrew, npm, `~/.local/bin`), so a planner or writer that works in a terminal works in the app too.

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

The desktop task composer keeps its draft, selected task tab and run options across navigation and app restarts. **Recent tasks** loads any of the last 30 submissions with its original launch options. **Use task** in Runs and **Run again** in Live or Replay load a recorded task into the composer; press **Start run** to run it. Older recordings use current defaults for launch options they did not record.

An installed app shows only **Goal on any site**: the testbed tasks need the testbed server from a source checkout, so a release hides them until **Testbed tasks** is turned on under Setup → Developer. Whatever still blocks a start (no goal, no start URL, no TypeSafe key, a run in progress) is listed under the Start button; a signed-in ChatGPT plan covers planner and writer calls but not Jev, which always needs the TypeSafe key. The engine host's output goes to `engine-host.log` in the app's logs folder (**Open logs folder** under Setup → Developer): send that file when a run will not start.

**Clear inputs** resets the task draft. **Clear recent tasks** removes the shortcut list without deleting run recordings. Setup remembers its selected tab and unsaved nonsecret fields; **Reset fields** restores saved settings, and **Clear profile inputs** empties the profile forms. Credential values and sign-in responses stay out of this draft cache. Desktop goals accept up to 32,000 characters, with a visible count and an error for longer drafts; pasted text is kept intact.

## Repository layout

Web CUA and QA runs support optional automation-marker reduction, consistent browser settings, paced input, browser proxies and external FlareSolverr preparation. See [Web browser behavior](docs/browser-behavior.md) for desktop controls, CLI flags and configuration.

- `packages/*`: the engine libraries (`@ghosthand/protocol`, `core`, `decision-typesafe`, `driver-playwright`, `recorder`, …).
- `apps/cli`: the `ghosthand` command. `apps/testbed`: a deterministic web app the agent is measured against. `apps/desktop`: the Electron app (Phase 2).
- `docs/`: architecture, ADRs, plan, research notes, phase reports. Contributors and coding agents start with [`AGENTS.md`](AGENTS.md).

## App artwork

The supplied ghost hand is preserved in [`assets/brand/source/ghosthand-original.png`](assets/brand/source/ghosthand-original.png). Use transparent PNG wherever the destination supports it. Opaque exports use a solid black background.

| Destination | Assets |
| --- | --- |
| UI, documentation and Linux | `assets/brand/png/ghosthand-{size}.png`, at 16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512 and 1024 pixels |
| Opaque square artwork | Matching sizes in `assets/brand/black/`, plus `ghosthand.jpg` at 1024 pixels |
| Browser | `assets/brand/web/brand/`: transparent PNG favicons, black ICO fallback and black Apple touch icon |
| Sharing | `assets/brand/social/ghosthand-1200x630.png` and `.jpg`, both on black |
| Desktop packages | `apps/desktop/build/icon.png` for Linux, black `icon.ico` for Windows and black `icon.icns` for macOS |
| Windows installer | Black 24-bit `installer-header.bmp` and `installer-sidebar.bmp` in `apps/desktop/build/` |

The desktop and testbed builds copy the same browser assets, and their headers display transparent PNGs. Platform packaging uses the [electron-builder icon configuration](https://www.electron.build/v26/docs/features/icons-and-images/). The source is centered with padding for its glow; its proportions and colors are preserved. Rebuild the exports with `bun run brand:prepare` after installing ImageMagick 7. The generated exports are included in the repository, so normal builds and releases do not need ImageMagick.

## License

GhostHand is licensed under [AGPL-3.0-only](LICENSE). You may use, modify, sell and host it. If you distribute it, or offer a modified version over a network, you must share your source under AGPL-3.0. Want to ship it under other terms? Contact the maintainer about a commercial license. Contributions require signing the [CLA](CONTRIBUTING.md#contributor-license-agreement). The name is covered by [TRADEMARKS.md](TRADEMARKS.md).
