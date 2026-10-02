<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0014. Unquoted text, cookie banners, stuck reasons, and secrets in unsigned builds

- Status: proposed
- Date: 2026-10-03

## Context

Rami's first runs of the packaged app (macOS and Windows, v0.0.4) all ended "stuck" after three to five steps, with zero model calls, on goals such as "go to google maps and search for a vegan restorant in berlin" and a login brief with the credentials written inline. Replaying the same goals from the CLI showed four separate causes:

1. `set_value` only offered text that was quoted in the goal (or a number, date, email). An unquoted search phrase or an inline password gave Jev no text option, so every step was refused with `target_named: no text option chosen`.
2. The writer was wired to the models layer only when `OPENAI_API_KEY` was set; otherwise it used the Codex CLI. In the packaged app the user was signed in with the ChatGPT plan (no API key), and a Finder- or Dock-launched app has a minimal PATH without the Codex CLI. Dev Electron inherits the shell's PATH and `~/.config/ghosthand/env`, which is why it worked there.
3. On Google's cookie consent page Jev split between "Accept all" and "Reject all" (both advance), and the target-confidence gate refused the step three times. Jev also often splits between two operations on a certain target ("set_value 46 %, press 27 %" on a search box), which the operation gate refused.
4. The stop reason was the generic "3 consecutive steps refused by gates", so none of this was visible in the app.

Separately, the macOS build is ad-hoc signed (`identity: "-"`). The Keychain ties its permissions to a verifiable code signature; an ad-hoc app gets a password prompt on every launch and "Always Allow" never sticks. Gatekeeper blocks the first launch for the same reason.

## Decision

- `extractLiterals` also offers unquoted phrases from the usual goal wordings: "search for X", "do a X search", "type X into", "set Y to X", "with the text X", labeled lines (`Password: X`) and password-like tokens (8+ characters mixing three character classes). Candidates are ranked so that quoted text, emails and credentials survive the 40-option cap. The chosen text needs probability `gates.text` (0.5) rather than `gates.target`, because typing is replaceable.
- A cookie consent banner the goal is not about is answered by code with its least-permissive choice ("Reject all" and the equivalents in common languages), once per screen, as a mode A step. It requires a visible accept-type button next to it, so a lone "Decline" in a form is never pressed.
- When Jev splits between operations but the top operation's target is at least `gates.sureTarget` (0.9) sure and the effect is `advance`, the top operation runs. Commits still need a confident operation or a human approval.
- The loop records in words why each refused step made no progress (`explainRefusal`), and every generic stop reason carries the first three distinct problems ("… : Jev wanted to type into textbox "Search" but the goal does not contain the text to type, and no writer model is set up …"). Writer failures are appended. The desktop app shows this as "why it stopped" on the live and replay pages, and `run.start` records which planner and writer the run had.
- The writer in `auto` mode uses the models layer whenever any provider serves the writer role (API key, ChatGPT plan, local server), and only then falls back to the Codex CLI; a missing writer is reported as a warning in the assistants summary. The desktop main process extends PATH from the login shell and the common install folders before starting the engine host, and Setup → Providers accepts Anthropic, Google and OpenRouter keys.
- In an ad-hoc signed macOS build (detected with `codesign -dv` at startup) the secret store encrypts with its own AES-256-GCM key kept in a 0600 file in the app's data folder instead of `safeStorage`, migrating Keychain-encrypted files once. A Developer ID build keeps using the Keychain. The README and release notes describe the Gatekeeper and SmartScreen steps.

## Consequences

More text is offered to Jev, so a goal can contain phrases that are not meant to be typed; Jev still chooses. On the same day, with the same Jev model and no vision provider, the L1–L3 eval (n=1) went from 12/18 on `main` to 16/18 on this branch; the two remaining failures (`l2-orders-sort-find`, `l2-injection-reviews`) need vision or an answer model. The local key is readable by anything running as the user, which is the same class of protection as Chromium's `basic_text`; it is stated in Setup. Gatekeeper and SmartScreen prompts remain until the builds are signed and notarized, which needs an Apple Developer account and a Windows certificate.
