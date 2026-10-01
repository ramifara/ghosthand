<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0003. Core style: plain TypeScript, typed Result errors, Zod schemas

- Status: accepted
- Date: 2026-10-01

## Context
Agent code fails in many expected ways (timeouts, model abstentions, stale elements, auth errors). Exceptions make these failures invisible in types.

## Decision
- Plain TypeScript with `async/await`. No effect system.
- A small in-house `Result<T, E>` (`ok`, `err`, `isOk`, `isErr`) lives in `@ghosthand/protocol` instead of `neverthrow`, so every package shares one tiny, dependency-free type. `E` is a discriminated union on `kind`.
- Expected failures are returned, never thrown. Exceptions are reserved for programmer errors. Third-party exceptions are caught and mapped at package boundaries.
- Zod v4 schemas in `@ghosthand/protocol` define every cross-process shape; TypeScript types are inferred from them.

## Consequences
- Callers must handle errors explicitly. Some boilerplate at call sites.
- If combinators become painful, `neverthrow` can replace the helpers with a mechanical change.
