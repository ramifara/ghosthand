<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0010. Desktop drivers: JSON-RPC native hosts, client-side element table, sandboxes first

- Status: proposed
- Date: 2026-10-01

## Context
Plan §7 Phase 7 asks for desktop `Computer`s as separate processes over JSON-RPC: a Linux X11 container, GNOME Wayland, Windows UIA and macOS AX, following cua RFC 4268 for candidates. The research note `desktop-inspiration.md` lists the pitfalls (role drift between hosts, untrusted Wayland extents, consent prompts, coordinate spaces). Several choices were open: where role mapping lives, the wire format, which language each host uses, how a Linux host gets AT-SPI without sudo, and how much of the user's own session a driver may touch.

## Decision
- **Wire format.** Newline-delimited JSON-RPC 2.0 on the host's stdio, one request at a time (input is serialized). The contract is `packages/protocol/src/desktop-rpc.ts` (zod). Hosts announce `ready` (or `fatal`) after start-up. The X11 and Wayland hosts carry the protocol on fd 3, because services that a private `dbus-run-session` activates inherit stdout.
- **Hosts are thin; the client owns the element table.** Hosts report native facts only: role, subrole, label, value (never for secret fields, length only), states in one shared vocabulary (AT-SPI names), interfaces/patterns, action names, bounds, and before/after read-backs around each action. `@ghosthand/driver-desktop` maps roles to ARIA (one table per host; AT-SPI `text` is a textbox only when editable, UIA `Text` is static text), computes role classes, offered operations, risk, row context, stable ids (`<host>:<role>:<slug>` plus a hash of the ancestor path for duplicates, per RFC 4268), redacts, issues tokens and judges effects. This avoids the role drift the note found in cua, where each adapter wrote its own shape.
- **Freshness twice.** Tokens are `e<ref>d<n>` and valid for the client's latest snapshot only. Hosts also accept refs of their latest snapshot only and check the element is alive. Nothing is re-resolved. Verification reads are `transient` snapshots that do not invalidate tokens.
- **Languages.** Linux: Python 3 with PyGObject/libatspi (system packages, LGPL), because it is installable without sudo in the container and present on GNOME hosts, and it reaches Mutter's D-Bus APIs through Gio. Windows: C# on .NET 8 (`System.Windows.Automation` + `SendInput`, per-monitor v2 DPI manifest). macOS: Swift (`AXUIElement`, `CGEvent`, `screencapture`). None of these are npm dependencies.
- **Sandboxes first.** The X11 driver runs in a container (docker or podman: no network, all capabilities dropped, an unprivileged user, a private display) or, without a container runtime, on the host as an unprivileged user on a private Xvfb display with a private D-Bus session and runtime dir. The GNOME Wayland driver runs `mutter --headless --virtual-monitor` in a private D-Bus session with a private runtime dir and PipeWire; input goes through Mutter's own RemoteDesktop API on that private bus, so there is no consent prompt and nothing touches the user's session. Driving the user's own GNOME session (portal RemoteDesktop + restore token + libei) is refused for now. Windows and macOS hosts act on the real desktop and start only with `--allow-host-desktop`.
- **Image tag = input hash.** The sandbox image is tagged with a hash of the Containerfile, the host sources and the testbed app, and built on first use. A stale image cannot run newer client code.
- **AT-SPI registry bootstrap.** Inside a private `dbus-run-session`, systemd-activated buses (dbus-broker on Arch/CachyOS) cannot start `at-spi2-registryd`. The host starts it itself when nobody owns the registry name.
- **Recordings fail closed.** Video pixels cannot be redacted. If a secret goes into a field that shows its text while recording, the recording is removed.

## Consequences
- One client implementation serves four hosts; a new host only has to emit the contract.
- The X11 and Wayland paths run and are tested here; Windows and macOS are compiled in CI, and their app smokes are best effort on hosted runners.
- Running the user's own GNOME session needs a portal/libei implementation and a consent flow; it is not built.
- The Linux host needs python3-gobject and libatspi on the host for host mode; the container has them.
