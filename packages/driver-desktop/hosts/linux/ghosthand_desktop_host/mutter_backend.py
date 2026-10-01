# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""GNOME Wayland backends.

1. Headless sandbox (default, `--sandbox`): `mutter --headless --virtual-monitor` in a private D-Bus session and
   a private XDG_RUNTIME_DIR with its own PipeWire. Input goes through Mutter's own RemoteDesktop D-Bus API
   (no consent prompt: it is our private compositor), screenshots through a Mutter ScreenCast PipeWire stream.
2. Host session (`--host-session`, opt-in, never used by tests): xdg-desktop-portal RemoteDesktop + ScreenCast
   with persist_mode=2 and a restore token (on SelectDevices, never on SelectSources), stored 0600 under
   $XDG_STATE_HOME/ghosthand. The portal shows the GNOME consent dialog the first time.

Pitfalls handled (docs/research/notes/desktop-inspiration.md §11): AT-SPI extents are window-relative on Mutter,
so element bounds are untrusted and actions are semantic; letters and digits are sent as evdev keycodes because
Mutter drops keysyms missing from the layout; every press is released; Mutter 50.2/50.3 drop the first pointer
events, so the session is warmed up with no-op motions; all input is serialized by the RPC loop.
"""

import os
import shutil
import signal
import subprocess
import tempfile
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

from .keys import KEYSYMS  # noqa: E402
from .rpc import RpcError, log  # noqa: E402

RD_BUS = "org.gnome.Mutter.RemoteDesktop"
SC_BUS = "org.gnome.Mutter.ScreenCast"
DC_BUS = "org.gnome.Mutter.DisplayConfig"
BUTTONS = {"left": 0x110, "right": 0x111, "middle": 0x112}  # BTN_LEFT, BTN_RIGHT, BTN_MIDDLE
# evdev keycodes for US layout letters/digits (Mutter drops keysyms not in the current layout group).
EVDEV = {
    **{c: code for c, code in zip("1234567890", (2, 3, 4, 5, 6, 7, 8, 9, 10, 11))},
    **{c: code for c, code in zip("qwertyuiop", range(16, 26))},
    **{c: code for c, code in zip("asdfghjkl", range(30, 39))},
    **{c: code for c, code in zip("zxcvbnm", range(44, 51))},
    " ": 57,
}
KEYSYM_VALUES = {
    "Return": 0xFF0D, "Escape": 0xFF1B, "Tab": 0xFF09, "BackSpace": 0xFF08, "Delete": 0xFFFF, "Insert": 0xFF63,
    "space": 0x20, "Up": 0xFF52, "Down": 0xFF54, "Left": 0xFF51, "Right": 0xFF53, "Home": 0xFF50, "End": 0xFF57,
    "Prior": 0xFF55, "Next": 0xFF56, "ctrl": 0xFFE3, "shift": 0xFFE1, "alt": 0xFFE9, "super": 0xFFEB,
    "Caps_Lock": 0xFFE5, "Menu": 0xFF67,
    **{f"F{i}": 0xFFBE + i - 1 for i in range(1, 13)},
}
KEY_HOLD_S = 0.035


def _bus():
    return Gio.bus_get_sync(Gio.BusType.SESSION, None)


def _call(bus, name, path, iface, method, params=None, reply=None, timeout_ms=10000, fd_list=None):
    try:
        if fd_list is not None:
            res, _ = bus.call_with_unix_fd_list_sync(
                name, path, iface, method, params, GLib.VariantType(reply) if reply else None,
                Gio.DBusCallFlags.NONE, timeout_ms, fd_list, None,
            )
            return res
        return bus.call_sync(
            name, path, iface, method, params, GLib.VariantType(reply) if reply else None,
            Gio.DBusCallFlags.NONE, timeout_ms, None,
        )
    except GLib.Error as e:
        raise RpcError("driver", f"{iface}.{method}: {e.message}") from e


def _name_has_owner(bus, name):
    try:
        r = bus.call_sync(
            "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner",
            GLib.Variant("(s)", (name,)), GLib.VariantType("(b)"), Gio.DBusCallFlags.NONE, 2000, None,
        )
        return bool(r.unpack()[0])
    except GLib.Error:
        return False


def _iterate(seconds):
    ctx = GLib.MainContext.default()
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        while ctx.pending():
            ctx.iteration(False)
        time.sleep(0.01)


class HeadlessMutter:
    """mutter --headless with a private runtime dir and PipeWire. Requires a private session bus already."""

    def __init__(self, size=(1280, 800)):
        self.size = size
        self.procs = []
        self.runtime_dir = None
        self.wayland_display = "ghosthand-wayland-0"
        self.pipewire = False

    def start(self):
        if shutil.which("mutter") is None:
            raise RuntimeError("mutter is not installed")
        # The launcher normally creates the private runtime dir before dbus-run-session (so activated services
        # use it too); otherwise make one here.
        if os.environ.get("GHOSTHAND_PRIVATE_RUNTIME") == "1" and os.environ.get("XDG_RUNTIME_DIR"):
            self.runtime_dir = None
        else:
            self.runtime_dir = tempfile.mkdtemp(prefix="ghosthand-wl-")
            os.chmod(self.runtime_dir, 0o700)
            os.environ["XDG_RUNTIME_DIR"] = self.runtime_dir
        os.environ["WAYLAND_DISPLAY"] = self.wayland_display
        os.environ.pop("DISPLAY", None)
        os.environ["XDG_SESSION_TYPE"] = "wayland"
        os.environ["GVFS_DISABLE_FUSE"] = "1"
        os.environ["GIO_USE_VFS"] = "local"
        env = dict(os.environ)
        if shutil.which("pipewire"):
            self._spawn(["pipewire"], env)
            time.sleep(0.3)
            if shutil.which("wireplumber"):
                self._spawn(["wireplumber"], env)
            self.pipewire = True
        w, h = self.size
        self._spawn(
            ["mutter", "--headless", "--wayland", "--no-x11", "--wayland-display", self.wayland_display,
             "--virtual-monitor", f"{w}x{h}"],
            env,
        )
        bus = _bus()
        deadline = time.monotonic() + 15
        while not (_name_has_owner(bus, RD_BUS) and _name_has_owner(bus, SC_BUS)):
            if time.monotonic() > deadline:
                raise RuntimeError("headless mutter did not expose RemoteDesktop/ScreenCast within 15 s")
            if any(p.poll() is not None for p in self.procs[-1:]):
                raise RuntimeError("mutter exited during start-up")
            time.sleep(0.1)
        log("headless mutter up; pipewire:", self.pipewire)
        return self

    def _spawn(self, args, env):
        p = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
        self.procs.append(p)
        return p

    def stop(self):
        for p in reversed(self.procs):
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
        for p in reversed(self.procs):
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
        self.procs = []
        if self.runtime_dir:
            shutil.rmtree(self.runtime_dir, ignore_errors=True)


class MutterRemoteDesktop:
    """Input and capture through org.gnome.Mutter.RemoteDesktop/ScreenCast on the (private) session bus."""

    route = "mutter.remote_desktop"

    def __init__(self, size, with_stream=True):
        self.bus = _bus()
        self.size = size
        self.stream_path = None
        self.node_id = None
        self.method = None
        r = _call(self.bus, RD_BUS, "/org/gnome/Mutter/RemoteDesktop", RD_BUS, "CreateSession", None, "(o)")
        self.session = r.unpack()[0]
        session_id = self._prop(self.session, f"{RD_BUS}.Session", "SessionId")
        if with_stream:
            try:
                r = _call(self.bus, SC_BUS, "/org/gnome/Mutter/ScreenCast", SC_BUS, "CreateSession",
                          GLib.Variant("(a{sv})", ({"remote-desktop-session-id": GLib.Variant("s", session_id)},)), "(o)")
                sc_session = r.unpack()[0]
                connector = self._connector()
                r = _call(self.bus, SC_BUS, sc_session, f"{SC_BUS}.Session", "RecordMonitor",
                          GLib.Variant("(sa{sv})", (connector, {"cursor-mode": GLib.Variant("u", 0)})), "(o)")
                self.stream_path = r.unpack()[0]
                self.bus.signal_subscribe(SC_BUS, f"{SC_BUS}.Stream", "PipeWireStreamAdded", self.stream_path, None,
                                          Gio.DBusSignalFlags.NONE, self._on_stream, None)
            except RpcError as e:
                log("screencast stream unavailable:", e.message)
                self.stream_path = None
        _call(self.bus, RD_BUS, self.session, f"{RD_BUS}.Session", "Start")
        deadline = time.monotonic() + 5
        while self.stream_path and self.node_id is None and time.monotonic() < deadline:
            _iterate(0.05)
        if self.node_id is not None and shutil.which("gst-launch-1.0"):
            self.method = "pipewire"
        # Mutter 50.2/50.3 drop the first pointer events; warm up with no-op relative motions.
        for _ in range(6):
            self._rd("NotifyPointerMotionRelative", GLib.Variant("(dd)", (0.0, 0.0)))

    def _on_stream(self, _bus, _sender, _path, _iface, _signal, params, _data):
        self.node_id = params.unpack()[0]

    def _prop(self, path, iface, name):
        r = _call(self.bus, RD_BUS, path, "org.freedesktop.DBus.Properties", "Get",
                  GLib.Variant("(ss)", (iface, name)), "(v)")
        return r.unpack()[0]

    def _connector(self):
        r = _call(self.bus, DC_BUS, "/org/gnome/Mutter/DisplayConfig", DC_BUS, "GetCurrentState", None)
        _serial, monitors, _logical, _props = r.unpack()
        if not monitors:
            raise RpcError("driver", "no monitors in the headless session")
        return monitors[0][0][0]

    def available(self):
        return True

    def _rd(self, method, params):
        _call(self.bus, RD_BUS, self.session, f"{RD_BUS}.Session", method, params)

    def move(self, x, y):
        if self.stream_path:
            self._rd("NotifyPointerMotionAbsolute", GLib.Variant("(sdd)", (self.stream_path, float(x), float(y))))
        else:
            # No stream: fake an absolute move (relative to the top-left corner, then to the target).
            self._rd("NotifyPointerMotionRelative", GLib.Variant("(dd)", (-100000.0, -100000.0)))
            self._rd("NotifyPointerMotionRelative", GLib.Variant("(dd)", (float(x), float(y))))

    def _button(self, button, pressed):
        self._rd("NotifyPointerButton", GLib.Variant("(ib)", (BUTTONS.get(button, BUTTONS["left"]), pressed)))

    def click(self, x, y, button="left", count=1):
        self.move(x, y)
        for _ in range(max(1, min(3, count))):
            self._button(button, True)
            try:
                time.sleep(0.02)
            finally:
                self._button(button, False)
            time.sleep(0.06)

    def drag(self, x0, y0, x1, y1):
        self.move(x0, y0)
        self._button("left", True)
        try:
            for i in range(1, 9):
                self.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8)
                time.sleep(0.02)
        finally:
            self._button("left", False)

    def scroll(self, dx, dy, x=None, y=None):
        if x is not None and y is not None:
            self.move(x, y)
        for axis, delta in ((0, dy), (1, dx)):
            if not delta:
                continue
            steps = max(-30, min(30, round(delta / 100))) or (1 if delta > 0 else -1)
            self._rd("NotifyPointerAxisDiscrete", GLib.Variant("(ui)", (axis, steps)))

    def _key_event(self, key, pressed):
        low = key.lower() if len(key) == 1 else key
        if len(key) == 1 and low in EVDEV and not key.isupper():
            self._rd("NotifyKeyboardKeycode", GLib.Variant("(ub)", (EVDEV[low], pressed)))
            return
        sym = KEYSYM_VALUES.get(key) or KEYSYM_VALUES.get(KEYSYMS.get(key.lower(), ""), None)
        if sym is None and len(key) == 1:
            sym = ord(key) if ord(key) < 0x100 else 0x01000000 + ord(key)
        if sym is None:
            raise RpcError("unsupported", f"unknown key {key}")
        self._rd("NotifyKeyboardKeysym", GLib.Variant("(ub)", (sym, pressed)))

    def _tap(self, key):
        self._key_event(key, True)
        try:
            time.sleep(KEY_HOLD_S)
        finally:
            self._key_event(key, False)

    def type_text(self, text):
        for ch in text:
            if ch == "\n":
                self._tap("Return")
            elif ch.isupper() and ch.lower() in EVDEV:
                self._key_event("shift", True)
                try:
                    self._tap(ch.lower())
                finally:
                    self._key_event("shift", False)
            else:
                self._tap(ch)
            time.sleep(0.008)

    def key(self, keys):
        from .keys import combo  # noqa: PLC0415

        parts = combo(keys).split("+")
        pressed = []
        try:
            for p in parts:
                self._key_event(p, True)
                pressed.append(p)
            time.sleep(KEY_HOLD_S)
        finally:
            for p in reversed(pressed):
                self._key_event(p, False)

    # ---- capture --------------------------------------------------------------------------------

    def screenshot(self, region=None):
        if self.method != "pipewire":
            raise RpcError("unsupported", "no PipeWire screencast stream (install pipewire and the GStreamer pipewire plugin)")
        args = ["gst-launch-1.0", "-q", "pipewiresrc", f"path={self.node_id}", "num-buffers=1", "do-timestamp=true", "!",
                "videoconvert"]
        if region:
            w, h = self.size
            args += ["!", "videocrop", f"left={int(region['x'])}", f"top={int(region['y'])}",
                     f"right={max(0, w - int(region['x'] + region['width']))}",
                     f"bottom={max(0, h - int(region['y'] + region['height']))}"]
        args += ["!", "pngenc", "snapshot=true", "!", "fdsink", "fd=1"]
        r = subprocess.run(args, capture_output=True, timeout=15, check=False, env=dict(os.environ))
        if r.returncode != 0 or not r.stdout.startswith(b"\x89PNG"):
            raise RpcError("driver", f"pipewire capture failed: {r.stderr.decode(errors='replace')[:200]}")
        return r.stdout


def create_mutter_host(args, cleanup):
    if getattr(args, "host_session", False):
        raise RuntimeError("the host-session portal backend is opt-in and launched with --host-session; see docs")
    if not args.sandbox:
        raise RuntimeError("the mutter backend needs --sandbox (a private headless compositor)")
    w, h = args.size
    sandbox = HeadlessMutter((w, h)).start()
    cleanup.append(sandbox.stop)
    from .a11y_bootstrap import bootstrap_a11y  # noqa: PLC0415

    bootstrap_a11y(cleanup)
    from .host import Host  # noqa: PLC0415 - libatspi loads after the registry is up
    rd = MutterRemoteDesktop((w, h), with_stream=sandbox.pipewire)

    def extra_doctor():
        return [
            {"name": "compositor", "ok": True, "detail": f"mutter --headless {w}x{h} ({sandbox.wayland_display})"},
            {"name": "pipewire", "ok": sandbox.pipewire, "detail": f"stream node {rd.node_id}" if rd.node_id else "no stream"},
            {"name": "element bounds", "ok": True, "detail": "untrusted on Wayland (AT-SPI extents are window-relative)"},
        ]

    host = Host(
        platform="linux-wayland",
        input_backend=rd,
        capture=rd,
        screen={"width": w, "height": h, "scale": 1},
        bounds_trust="none",
        sandbox=None,
        extra_doctor=extra_doctor,
    )
    return host
