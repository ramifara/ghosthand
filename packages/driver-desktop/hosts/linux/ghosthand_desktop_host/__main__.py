# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""Entry point: `python3 -m ghosthand_desktop_host --backend x11 --sandbox [--display :1] [--size 1280x800]`."""

import argparse
import os
import signal
import sys

from .rpc import log, serve


def _size(text):
    w, h = text.lower().split("x")
    return int(w), int(h)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="ghosthand_desktop_host")
    ap.add_argument("--backend", choices=("x11", "mutter"), default="x11")
    ap.add_argument("--sandbox", action="store_true", help="start a private display (Xvfb or headless Mutter)")
    ap.add_argument("--display", default=os.environ.get("DISPLAY", ":1"))
    ap.add_argument("--size", type=_size, default=(1280, 800))
    ap.add_argument("--wm", default="auto", help="auto, xfwm4, mutter, openbox, twm or none")
    ap.add_argument("--vnc-port", type=int, default=None)
    args = ap.parse_args(argv)

    # Protocol on its own descriptor: GHOSTHAND_RPC_FD (set by the launch wrappers, because D-Bus-activated
    # services inherit the session's stdout) or stdout. Anything else that prints goes to stderr.
    rpc_fd = int(os.environ.pop("GHOSTHAND_RPC_FD", "1"))
    proto_out = os.fdopen(os.dup(rpc_fd), "w", buffering=1, encoding="utf-8")
    if rpc_fd != 1:
        os.close(rpc_fd)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = proto_out

    cleanup = []

    def shutdown(*_):
        for fn in reversed(cleanup):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                log("cleanup error:", type(e).__name__)
        os._exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        if args.backend == "x11":
            host = _x11(args, cleanup)
        else:
            from .mutter_backend import create_mutter_host  # noqa: PLC0415

            host = create_mutter_host(args, cleanup)
    except Exception as e:  # noqa: BLE001 - reported to the client as a startup failure
        log("startup failed:", f"{type(e).__name__}: {e}")
        sys.stdout.write(
            '{"jsonrpc":"2.0","method":"fatal","params":{"kind":"launch_failed","message":%s}}\n'
            % _json_str(f"{type(e).__name__}: {e}")
        )
        sys.stdout.flush()
        shutdown()
        return 1
    cleanup.append(host.close)
    sys.stdout.write('{"jsonrpc":"2.0","method":"ready","params":{}}\n')
    sys.stdout.flush()
    serve(host.handlers())
    shutdown()
    return 0


def _json_str(s):
    import json  # noqa: PLC0415

    return json.dumps(s)


def _x11(args, cleanup):
    from .sandbox import X11Sandbox  # noqa: PLC0415

    sandbox = None
    if args.sandbox:
        sandbox = X11Sandbox(display=args.display, size=args.size, wm=args.wm, vnc_port=args.vnc_port).start()
        cleanup.append(sandbox.stop)
    elif not os.environ.get("DISPLAY"):
        raise RuntimeError("no DISPLAY; pass --sandbox to start Xvfb")
    os.environ["DISPLAY"] = args.display
    from .a11y_bootstrap import bootstrap_a11y  # noqa: PLC0415

    bootstrap_a11y(cleanup)

    from .host import Host  # noqa: PLC0415 - imports gi/Atspi after DISPLAY and the registry are up
    from .x11_capture import X11Capture  # noqa: PLC0415
    from .x11_input import X11Input  # noqa: PLC0415
    w, h = args.size
    return Host(
        platform="linux-x11",
        input_backend=X11Input(args.display),
        capture=X11Capture(args.display, (w, h)),
        screen={"width": w, "height": h, "scale": 1},
        bounds_trust="exact",
        sandbox=sandbox,
    )


if __name__ == "__main__":
    sys.exit(main())
