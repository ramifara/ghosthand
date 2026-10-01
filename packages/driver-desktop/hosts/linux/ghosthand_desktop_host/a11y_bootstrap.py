# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""Makes sure the private session has a working AT-SPI bus and registry.

Inside `dbus-run-session`, distributions that activate services through systemd (dbus-broker, e.g. Arch and
CachyOS) cannot start `org.a11y.atspi.Registry` ("unit failed"). We ask the session bus for the a11y bus
(activating at-spi-bus-launcher) and, if nobody owns the registry name on it, start at-spi2-registryd ourselves.
Must run before libatspi is initialised.
"""

import os
import shutil
import subprocess
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

from .rpc import log  # noqa: E402

REGISTRYD = ("/usr/lib/at-spi2-registryd", "/usr/libexec/at-spi2-registryd", "/usr/lib/at-spi2-core/at-spi2-registryd")
LAUNCHER = ("/usr/lib/at-spi-bus-launcher", "/usr/libexec/at-spi-bus-launcher", "/usr/lib/at-spi2-core/at-spi-bus-launcher")


def _owner(conn, name):
    try:
        r = conn.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner",
                           GLib.Variant("(s)", (name,)), GLib.VariantType("(b)"), Gio.DBusCallFlags.NONE, 2000, None)
        return bool(r.unpack()[0])
    except GLib.Error:
        return False


def _a11y_address(session):
    r = session.call_sync("org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus", "GetAddress", None,
                          GLib.VariantType("(s)"), Gio.DBusCallFlags.NONE, 10000, None)
    return r.unpack()[0]


def ensure_registry(procs):
    """Returns a short status line. Spawned helpers are appended to `procs` for cleanup."""
    session = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    try:
        address = _a11y_address(session)
    except GLib.Error as e:
        launcher = next((p for p in LAUNCHER if os.path.exists(p)), None)
        if launcher is None:
            return f"no a11y bus ({e.message})"
        procs.append(subprocess.Popen([launcher], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, start_new_session=True))
        time.sleep(0.5)
        address = _a11y_address(session)
    try:
        a11y = Gio.DBusConnection.new_for_address_sync(
            address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            None, None)
    except GLib.Error as e:
        return f"cannot connect to the a11y bus: {e.message}"
    if _owner(a11y, "org.a11y.atspi.Registry"):
        return "registry running"
    # Try activation first (works with dbus-daemon); fall back to starting the daemon directly.
    try:
        a11y.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "StartServiceByName",
                       GLib.Variant("(su)", ("org.a11y.atspi.Registry", 0)), None, Gio.DBusCallFlags.NONE, 3000, None)
        if _owner(a11y, "org.a11y.atspi.Registry"):
            return "registry activated"
    except GLib.Error:
        pass
    registryd = next((p for p in REGISTRYD if os.path.exists(p)), shutil.which("at-spi2-registryd"))
    if registryd is None:
        return "at-spi2-registryd not found"
    procs.append(subprocess.Popen([registryd], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, start_new_session=True))
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if _owner(a11y, "org.a11y.atspi.Registry"):
            log("started at-spi2-registryd")
            return "registry started"
        time.sleep(0.05)
    return "registry did not start"


def bootstrap_a11y(cleanup):
    """Starts the AT-SPI registry when the private session cannot activate it. Call before libatspi loads."""
    from .sandbox import stop_procs  # noqa: PLC0415

    procs = []
    cleanup.append(lambda: stop_procs(procs))
    log("a11y:", ensure_registry(procs))
