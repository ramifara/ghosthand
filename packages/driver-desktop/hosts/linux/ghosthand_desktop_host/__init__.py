# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""GhostHand desktop RPC host for Linux (X11 sandbox and headless GNOME/Mutter).

Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout (contract: packages/protocol/src/desktop-rpc.ts).
Observes through AT-SPI, acts semantically first and falls back to synthetic input.
"""

PROTOCOL_VERSION = 1
HOST_VERSION = "0.1.0"
