<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0008. Desktop app: process model, IPC, screencast, takeover and ChatGPT sign-in

- Status: proposed
- Date: 2026-10-01

## Context
Phase 2 (plan §7) adds `apps/desktop`. The plan fixes the stack (electron-vite 5, electron-builder 26, Electron, React 19, TanStack, Zustand) and the security baseline (`docs/research/notes/monorepo-testbed.md` §2). It names three open decisions: screencast transport, window layout and keyboard map. Building the app raised a few more.

## Decision
- **Processes.** Main is a thin broker: window, settings, secrets (`safeStorage`), ChatGPT sign-in, IPC validation. `@ghosthand/engine` runs in an Electron `utilityProcess` (`src/engine-host/main.ts`), which also runs Playwright and launches the user's browser. One run at a time.
- **IPC.** The contract is `packages/protocol/src/ipc.ts` (zod). Renderer → main: one `invoke(command, input)`. Main checks the sender (top-level frame, `app://ghosthand` or the loopback dev origin), parses the input with the command's schema (strict objects) and answers with a `Result`-shaped envelope; handler exceptions become `internal` without their message. Main → host: `HostRequest`/`HostResponse` over `parentPort`, with settings and credentials attached by main per call (credentials only for `runs.start`, `doctor.run` and `models.list`). Host → renderer: a `MessageChannelMain` port carries `EngineMessage`s (run events, frames, approvals, status) without passing through main; a new port is handed over on every renderer load. The renderer re-validates outputs and port messages.
- **Screencast transport.** CDP `Page.startScreencast` on the agent's page (JPEG q60, ≤1280×960), from `WebComputer.startScreencast` via `page.context().newCDPSession(page)`. The host throttles to ~12 fps, keeping the newest frame. Frames are base64 strings in structured-clone messages and are shown as `data:` URLs; they are never written to disk. The overlay uses the action event's target bounds (top-viewport CSS px, now recorded on `action` events with the target confidence) projected as percentages of the frame's device size.
- **Takeover.** `runTask` takes a `RunControl`; its `checkpoint()` runs before each step and right before each act. A pause drops the pending decision, records a `human/takeover` event, excludes the paused time from the time budget and re-observes. Takeover brings the agent's browser window to the front; the user works in the real browser (the agent never drives an Electron window).
- **Approvals.** The loop's existing `approve` hook. "Allow once" grants this request, "Allow for this task" grants every later commit request of the run, "Deny" refuses. The dialog cannot be dismissed without an answer. Stop denies pending approvals.
- **Window layout.** Left rail (Task, Live, Runs, Setup), a status strip (engine state, decision source, plumbing-mode and "Using ChatGPT plan" labels), and two-pane pages: live view or screenshot on the left, the step tape on the right.
- **Keyboard map.** Ctrl+Shift+Space toggles takeover: handled in the window, and registered as a global shortcut only while a run is active (released when it ends). J/K or ↑/↓ step through a replay. All controls are native buttons, inputs, radios and selects with visible focus.
- **Plumbing mode.** A hidden developer setting (off by default) lets runs use core's `HeuristicDecisionProvider` when no TypeSafe key is set. It is labelled wherever a run would use it.
- **Sign in with ChatGPT.** Implemented in main from the documented SIWC flow (dynamic client registration, PKCE S256, `127.0.0.1` loopback on 1455 with an ephemeral fallback, paste-the-redirect fallback, token exchange and refresh at `auth.openai.com`, `resource=https://api.openai.com/v1`). Tokens are encrypted with `safeStorage`. The models layer gets an `openai-chatgpt` provider that only ever sends the token to `https://api.openai.com/v1` and adapts requests to the preview's rules (`store:false`, `stream:true`, rejected parameters stripped, system → developer; only `response.completed` counts). It is **behind a feature flag (off)** because plan usage is a preview and eligibility for this app is unconfirmed (research note §0). The id token's claims are checked; its signature is not, since it arrives over TLS from the token endpoint (OIDC Core §3.1.3.7) and the JWKS URL is unverified. Revocation and the "Manage usage" deep link are TODOs for the same reason.
- **Build.** electron-vite 5 with the repo's Vite 8 (peer range says ≤7): it works once main and the engine host declare their externals explicitly (`electron`, Node built-ins, `playwright-core`). Only `playwright-core` ships in `node_modules` (asar-unpacked); everything else is bundled. Preload is one CJS file. Fuses are set by electron-builder (`electronFuses`).
- **Electron version.** 43.x as specified, although 44 is now the npm `latest`.

## Consequences
- The renderer cannot reach Node, the network or secret values; a compromised renderer can only call validated commands.
- ChatGPT plan usage needs the flag turned on and a real sign-in before it can be called verified; the plan-specific "Continue with ChatGPT" logo asset is not bundled yet.
- Replay screenshots assume device pixel ratio 1 when placing the reticle.
- Electron e2e tests launch with `--ozone-platform=x11` on Linux: hidden Wayland windows paint once and then stop, so captures hang.
