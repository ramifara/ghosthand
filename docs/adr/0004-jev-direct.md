<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0004. Decisions: TypeSafe Jev, direct API

- Status: accepted
- Date: 2026-10-01

## Context
Each agent step needs a fast, calibrated choice among UI elements. TypeSafe Jev answers typed questions (noul, choice, score) in roughly 0.2–0.5 s with native probabilities. Direct access gives 64k context, exact version pinning and request IDs; OpenRouter lists 32k and adds a hop. See `docs/research/notes/typesafe-direct.md` and `openrouter-jev.md`.

## Decision
- Use `@typesafe-ai/sdk` pinned to `0.6.0` (`0.7.0` since ADR 0020), model pinned to `jev-1.13.0`, per-attempt timeout ~2.5 s, 1 retry, a per-step `AbortSignal`. Key `TYPESAFE_API_KEY` from `~/.config/ghosthand/env` (later Electron `safeStorage`).
- Wrap it behind a vendor-neutral `DecisionProvider` interface in `@ghosthand/protocol`/`core`. `@ghosthand/decision-typesafe` is the only importer of the SDK.
- Validate every response fail-closed: exact option keys, probabilities sum to 1 ± 0.025, choice is the argmax, score within 0.02 of the distribution mean; otherwise the answer becomes `abstain`.
- Compute cost locally (`input_tokens × $0.042/M`) and enforce our own spend cap.
- Never enable the SDK's `debug` log level (it logs full request bodies).

## Consequences
- No provider fallback on the direct API; other providers (OpenRouter, Vercel, Cloudflare) plug in behind the same interface later, once they reach parity.
- The SDK is pre-1.0 and may churn; the pin and adapter limit the blast radius.
