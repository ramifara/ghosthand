# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""Newline-delimited JSON-RPC 2.0 over stdio. One request at a time: input is serialized by design."""

import json
import sys
import traceback


class RpcError(Exception):
    """An expected failure, reported to the client as a JSON-RPC error with data.kind."""

    def __init__(self, kind, message, code=-32000):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.code = code


def log(*parts):
    """Logs go to stderr; stdout carries protocol messages only. Never log values typed into fields."""
    print("[ghosthand-host]", *parts, file=sys.stderr, flush=True)


def _write(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def notify(method, params):
    _write({"jsonrpc": "2.0", "method": method, "params": params})


def serve(handlers, on_idle=None):
    """Reads requests until EOF or a `close` request. `handlers` maps method names to fn(params) -> result."""
    stdin = sys.stdin
    while True:
        if on_idle is not None:
            on_idle()
        line = stdin.readline()
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            _write({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") or {}
        handler = handlers.get(method)
        if handler is None:
            if req_id is not None:
                _write(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32601, "message": f"unknown method {method}", "data": {"kind": "unsupported"}},
                    }
                )
            continue
        try:
            result = handler(params)
            if req_id is not None:
                _write({"jsonrpc": "2.0", "id": req_id, "result": result if result is not None else {}})
        except RpcError as e:
            if req_id is not None:
                _write(
                    {"jsonrpc": "2.0", "id": req_id, "error": {"code": e.code, "message": e.message, "data": {"kind": e.kind}}}
                )
        except Exception as e:  # noqa: BLE001 - reported to the client, never swallowed silently
            log("handler error:", method, type(e).__name__, str(e)[:300])
            log(traceback.format_exc(limit=4))
            if req_id is not None:
                _write(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32603, "message": f"{type(e).__name__}: {str(e)[:300]}", "data": {"kind": "driver"}},
                    }
                )
        if method == "close":
            return
