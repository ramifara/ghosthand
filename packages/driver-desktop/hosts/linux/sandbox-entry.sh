#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
#
# Container entry point: a private D-Bus session (so the AT-SPI bus exists) around the RPC host, which
# starts Xvfb, the window manager and the app itself. The container's stdout carries JSON-RPC only.
set -eu
: "${DISPLAY:=:1}"
export DISPLAY
# fd 3 carries JSON-RPC; stdout of everything else (dbus-daemon and the services it activates) goes to stderr.
exec 3>&1 1>&2
export GHOSTHAND_RPC_FD=3
exec dbus-run-session -- python3 -m ghosthand_desktop_host --backend x11 --sandbox "$@"
