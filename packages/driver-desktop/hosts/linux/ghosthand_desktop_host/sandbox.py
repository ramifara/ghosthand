# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""The X11 sandbox: Xvfb on a private display, an optional window manager and an optional VNC viewer.

Runs as an unprivileged user (in the container or on the host). Never touches the user's own display.
"""

import os
import shutil
import signal
import subprocess
import time

from .rpc import log

WINDOW_MANAGERS = ("xfwm4", "mutter", "openbox", "twm")


def _display_ready(display, env):
    xset = shutil.which("xset")
    if xset is None:
        socket = f"/tmp/.X11-unix/X{display.lstrip(':').split('.')[0]}"
        return os.path.exists(socket)
    r = subprocess.run([xset, "-display", display, "q"], env=env, capture_output=True, timeout=5, check=False)
    return r.returncode == 0


class X11Sandbox:
    def __init__(self, display=":1", size=(1280, 800), wm="auto", vnc_port=None):
        self.display = display
        self.size = size
        self.wm_choice = wm
        self.vnc_port = vnc_port
        self.procs = []
        self.wm = None
        self.vnc_url = None

    def start(self):
        xvfb = shutil.which("Xvfb")
        if xvfb is None:
            raise RuntimeError("Xvfb is not installed")
        num = self.display.lstrip(":").split(".")[0]
        if os.path.exists(f"/tmp/.X{num}-lock"):
            raise RuntimeError(f"display {self.display} is already in use")
        env = dict(os.environ, DISPLAY=self.display)
        w, h = self.size
        # -nolisten tcp: no network listener; the unix socket is private to the container/user.
        self._spawn(
            [xvfb, self.display, "-screen", "0", f"{w}x{h}x24", "-dpi", "96", "-nolisten", "tcp", "-noreset", "+extension", "XTEST"],
            env,
        )
        deadline = time.monotonic() + 10
        while not _display_ready(self.display, env):
            if time.monotonic() > deadline:
                raise RuntimeError("Xvfb did not come up within 10 s")
            time.sleep(0.05)
        os.environ["DISPLAY"] = self.display
        xset = shutil.which("xset")
        if xset:
            subprocess.run([xset, "s", "off", "-dpms"], env=env, capture_output=True, check=False)
        self._start_wm(env)
        if self.vnc_port:
            self._start_vnc(env)
        return self

    def _start_wm(self, env):
        choices = WINDOW_MANAGERS if self.wm_choice == "auto" else (self.wm_choice,)
        for name in choices:
            if name == "none":
                return
            path = shutil.which(name)
            if path is None:
                continue
            if name == "mutter":
                args = [path, "--x11", "--replace", "--sm-disable"]
                wm_env = dict(env, XDG_SESSION_TYPE="x11")
            elif name == "xfwm4":
                args = [path, "--compositor=off", "--sm-client-disable"]
                wm_env = env
            else:
                args = [path]
                wm_env = env
            self._spawn(args, wm_env)
            self.wm = name
            time.sleep(0.4)
            log("window manager:", name)
            return
        log("no window manager found; running without one")

    def _start_vnc(self, env):
        x11vnc = shutil.which("x11vnc")
        if x11vnc is None:
            log("x11vnc not installed; no live view")
            return
        rfb = 5900
        self._spawn(
            [x11vnc, "-display", self.display, "-forever", "-shared", "-nopw", "-localhost", "-rfbport", str(rfb), "-quiet"],
            env,
        )
        websockify = shutil.which("websockify")
        web = next((p for p in ("/usr/share/novnc", "/usr/share/webapps/novnc") if os.path.isdir(p)), None)
        if websockify and web:
            # Inside the container this listens on all container interfaces so the runner can publish it;
            # the runner binds the published port to 127.0.0.1 only.
            listen = os.environ.get("GHOSTHAND_VNC_LISTEN", "127.0.0.1")
            self._spawn([websockify, "--web", web, f"{listen}:{self.vnc_port}", f"localhost:{rfb}"], env)
            self.vnc_url = f"http://127.0.0.1:{self.vnc_port}/vnc.html?autoconnect=1"
        else:
            self.vnc_url = f"vnc://127.0.0.1:{rfb}"

    def _spawn(self, args, env):
        p = subprocess.Popen(
            args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
        )
        self.procs.append(p)
        return p

    def stop(self):
        stop_procs(self.procs)
        self.procs = []


def stop_procs(procs):
    """SIGTERM each process group (newest first), then SIGKILL what is left."""
    for p in reversed(procs):
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
    for p in reversed(procs):
        try:
            p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
