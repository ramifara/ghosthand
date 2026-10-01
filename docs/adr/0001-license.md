<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0001. License: AGPL-3.0-only with a CLA

- Status: accepted
- Date: 2026-10-01

## Context
GhostHand should be fully open source, and anyone shipping or hosting a modified version must keep it open or ask for a separate license. OpenAI's Sign in with ChatGPT plan usage is offered to open-source apps, which in practice means an OSI license. See `docs/research/notes/license.md`.

## Decision
- License the code under **AGPL-3.0-only** (verbatim text in `LICENSE`, SPDX headers in every source file, `REUSE.toml` for files without comments).
- Accept outside contributions under an Apache-ICLA-style **CLA** through cla-assistant.io, so a commercial license stays possible.
- Keep the name under `TRADEMARKS.md`. Track borrowed code and ideas in `THIRD_PARTY_NOTICES`.
- Dependencies must be MIT, BSD, ISC, Apache-2.0, MPL-2.0, LGPL, GPLv3 or similar permissive licenses. Disallowed: GPL-2.0-only, SSPL, BSL, Elastic, non-commercial licenses, closed SDKs. CI enforces this with `bun run license:check`.

## Consequences
- Some companies will not use AGPL code internally, which pushes them toward a commercial license (intended).
- The CLA adds friction for contributors; the README promises contributions stay available under AGPL.
- Protocol packages could be relicensed permissively later to ease integrations.
