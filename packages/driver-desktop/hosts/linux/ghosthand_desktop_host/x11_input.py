# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""Synthetic pointer and keyboard input on the sandbox display through XTest (xdotool).

Text is passed on stdin (`type --file -`), never on the command line, so it does not show up in `ps`.
"""

import shutil
import subprocess

from .keys import combo
from .rpc import RpcError

BUTTONS = {"left": "1", "middle": "2", "right": "3"}


class X11Input:
    route = "xtest"

    def __init__(self, display):
        self.display = display
        self.xdotool = shutil.which("xdotool")

    def available(self):
        return self.xdotool is not None

    def _run(self, args, stdin=None):
        if self.xdotool is None:
            raise RpcError("unsupported", "xdotool is not installed; pointer and keyboard input are unavailable")
        r = subprocess.run(
            [self.xdotool, *args],
            input=stdin,
            capture_output=True,
            timeout=30,
            check=False,
            env={"DISPLAY": self.display, "PATH": "/usr/bin:/bin"},
        )
        if r.returncode != 0:
            raise RpcError("driver", f"xdotool failed ({r.returncode}): {r.stderr.decode(errors='replace')[:200]}")

    def ensure_focus(self, pids):
        """Focuses a visible window of the launched app unless one already has X focus (private display only)."""
        if self.xdotool is None or not pids:
            return
        env = {"DISPLAY": self.display, "PATH": "/usr/bin:/bin"}
        r = subprocess.run([self.xdotool, "getwindowfocus", "getwindowpid"], capture_output=True, timeout=5,
                           check=False, env=env)
        if r.returncode == 0 and r.stdout.decode().strip() in {str(p) for p in pids}:
            return
        for pid in pids:
            r = subprocess.run([self.xdotool, "search", "--onlyvisible", "--pid", str(pid)], capture_output=True,
                               timeout=5, check=False, env=env)
            wins = r.stdout.decode().split()
            if wins:
                try:
                    self._run(["windowactivate", "--sync", wins[-1]])
                except RpcError:
                    self._run(["windowfocus", "--sync", wins[-1]])
                return

    def move(self, x, y):
        self._run(["mousemove", "--sync", str(int(round(x))), str(int(round(y)))])

    def click(self, x, y, button="left", count=1):
        self.move(x, y)
        self._run(["click", "--repeat", str(max(1, min(3, count))), "--delay", "60", BUTTONS.get(button, "1")])

    def drag(self, x0, y0, x1, y1):
        self.move(x0, y0)
        self._run(["mousedown", "1"])
        try:
            steps = 8
            for i in range(1, steps + 1):
                self.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        finally:
            self._run(["mouseup", "1"])

    def scroll(self, dx, dy, x=None, y=None):
        if x is not None and y is not None:
            self.move(x, y)
        # Wheel buttons: 4 up, 5 down, 6 left, 7 right. One click per ~100 px of requested delta.
        if dy:
            self._run(["click", "--repeat", str(max(1, min(30, round(abs(dy) / 100)))), "5" if dy > 0 else "4"])
        if dx:
            self._run(["click", "--repeat", str(max(1, min(30, round(abs(dx) / 100)))), "7" if dx > 0 else "6"])

    def type_text(self, text):
        self._run(["type", "--clearmodifiers", "--delay", "8", "--file", "-"], stdin=text.encode("utf-8"))

    def key(self, keys):
        self._run(["key", "--clearmodifiers", combo(keys)])
