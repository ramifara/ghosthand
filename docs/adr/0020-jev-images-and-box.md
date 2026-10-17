<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0020. Jev 1.14: screenshots as decision evidence and `box` grounding

- Status: accepted
- Date: 2026-10-17

## Context

Jev 1.14.0 (2026-10-14, `@typesafe-ai/sdk` 0.7.0) accepts PNG/JPEG images in `state`, `instructions` and `criteria` behind the opt-in header `TypeSafe-Danger-Zone-Images: true`, and answers a new `box` question that locates a described target on an image as four edge fractions plus a confidence. TypeSafe calls both "danger zone": formats, limits and accuracy may change between releases. Our live probe (`docs/research/notes/jev-1-14-images-box.md`) measured box centres landing inside the true UI element on all real targets, latency in the same 200–500 ms band as text, and about `240 + width×height/385` input tokens per image. GhostHand so far sends Jev text only and needs a paid LLM vision call for every pixel task (ADR 0011 modes D1/D2).

## Decision

- Pin `@typesafe-ai/sdk` to `0.7.0`. Keep its zstd request compression for the direct API; disable it for OpenRouter and Vercel carriers and in recorded tests.
- Two model pins: `decision.model` stays `jev-1.13.0` for text-only requests; `decision.visionModel` (default `jev-1.14.0`) serves every request that carries an image or a `box` question. Aliases (`jev-latest`, `jev-preview`) are never used in production paths.
- `Entry` stays JSON. Images travel as a separate `images` list on the ask options (`{ref, data, mimeType, width, height, captureId?}`); the state refers to an image by its `ref` string. The TypeSafe provider turns the list into SDK assets. One full-frame image per request, placed once in `state.screen`; questions refer to `` `screen` `` by path.
- The danger-zone images header is added per call and only when the request has images or a box question. The long-context header is never sent.
- Fail closed: a box answer is valid only if `0 ≤ top < bottom ≤ 1`, `0 ≤ left < right ≤ 1` and confidence is null or in [0, 1]; otherwise it abstains. A box is used for a click only when the paired presence noul ≥ `gates.boxPresent` (0.7), the box covers < 25 % of the image, and, with an element table, its centre lies inside an element's visible bounds or no element overlaps it. Box confidence is recorded, not gated on.
- Screenshots are prepared without new dependencies: the web driver asks Playwright for JPEG q80 at CSS scale with secret-bearing elements masked; desktop hosts downscale through new `screenshot` RPC parameters. No image is sent on the step after a secret `setValue`, and the desktop driver sends none while a secret value is on screen.
- Image tokens (`240 + ceil(w×h/385)` per use) count in preflight, the cost pre-check, request fitting and events.
- Setting `decision.images = off | grounding | always`, default `grounding`: images only in the new D0 "Jev box" grounding rung, which sits between C and D1 in the router and needs only a TypeSafe key. `always` also attaches the screenshot to act, narrow and verify requests; the default moves only on a measured gain.
- D0 steps are recorded with `mode: "D0"` and the box, and are not learned into recipes (as D1/D2, ADR 0011).
- New error kind `image_rejected` for 400s about images or assets; 413 maps to `too_large`; null usage counts fall back to the preflight estimate.

## Consequences

- Canvas, closed shadow DOM, icon-only controls and desktop hosts with weak accessibility bounds become reachable at Jev prices without an LLM vision key. The LLM modes remain the rung after D0.
- Each image request costs about 3k tokens for a 1280×834 screenshot (about $0.00013); `always` mode is a measurable, not assumed, trade-off.
- New run folders are not readable by readers older than this change (new question and answer types); old folders stay readable.
- `jev-latest` will move to 1.14.0 and 1.13.0 will be deprecated with 60 days' notice; `ghosthand doctor` checks the pinned model and the switch is one config value.
- The research note `docs/research/notes/typesafe-direct.md` remains valid for text requests; the new note supersedes its "text only" statements.
