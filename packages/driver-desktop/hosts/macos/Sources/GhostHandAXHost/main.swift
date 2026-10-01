// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Entry point: `ghosthand-ax-host` speaks JSON-RPC on stdio until stdin closes or `close` arrives.
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
let host = Host()
Rpc.serve(host.handlers())
