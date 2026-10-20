<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->
# Desktop drivers

GhostHand drives desktop apps through the same `Computer` interface as the web. Each surface has a small native host that speaks JSON-RPC on stdio (contract: `packages/protocol/src/desktop-rpc.ts`). The TypeScript client in `@ghosthand/driver-desktop` builds the element table, issues tokens, redacts and judges effects. Design and trade-offs: [ADR 0010](adr/0010-desktop-drivers.md).

| Surface | Flag | Where it runs | Touches your session? | Status |
|---|---|---|---|---|
| Linux X11 sandbox | `--surface x11` | container (docker/podman) or host Xvfb | no: private display, private D-Bus | works, tested here |
| GNOME Wayland sandbox | `--surface wayland` | `mutter --headless` on the host | no: private D-Bus, runtime dir and PipeWire | works, tested here |
| GNOME Wayland host session | none | your GNOME session (portal + libei) | yes | not built; refused |
| Windows UIA | `--surface windows --allow-host-desktop` | your Windows desktop | yes, opt-in | built in CI; not run here |
| macOS AX | `--surface macos --allow-host-desktop` | your Mac desktop | yes, opt-in | built in CI; not run here |

## Quick start (Linux)

```sh
ghosthand doctor                       # "desktop ..." lines show what is available
# A desktop testbed task (GTK app; the oracle reads the app's state file):
ghosthand run --task desktop-profile --yes
# Any app with a free-text goal:
ghosthand run --surface x11 --app "gnome-calculator" "Compute 12 times 7"
ghosthand run --surface wayland --app "gnome-text-editor" 'Type "hello" into the document'
```

`--task desktop-*` picks the X11 sandbox unless `--surface` says otherwise. Quote text the agent should type (`'Add "Tea" to the list'`): without a writer model, Jev only types literals from the goal. The desktop tasks are `desktop-profile`, `desktop-plan` and `desktop-list` (`packages/driver-desktop/src/testbed/desktop-tasks.ts`). To measure them with real Jev: `bun run eval:desktop -- --n 5 [--surface wayland]` (paid; never in CI).

With `--app`, the app must exist where the sandbox runs: inside the container for the X11 container (the image has `xterm` and the GTK testbed; add apps to the Containerfile, or pass `--build-arg WITH_CHROMIUM=1`), on the host for the Wayland sandbox and the host X11 sandbox.

## Linux X11 sandbox

- **Container (default when docker or podman works).** Image `ghosthand-x11:<hash>`, built on first use from `packages/driver-desktop/hosts/linux/Containerfile` (Debian trixie: Xvfb, xfwm4, at-spi2-core, python3-gi, xdotool, ffmpeg, x11vnc, noVNC). The tag is a hash of the Containerfile, the host and the testbed, so a stale image never runs. The first build downloads about 220 MB; set `GHOSTHAND_DEBIAN_MIRROR=http://<mirror>/debian` if `deb.debian.org` is slow. The container runs with `--network none`, `--cap-drop ALL`, `no-new-privileges`, an unprivileged user and a private shared folder mounted at `/work` (state files and recordings).
- **Host mode (`--runtime host`).** Needs `Xvfb`, `xdotool`, `dbus-run-session`, `python3-gobject` with the `Atspi` typelib and `at-spi2-core`. Runs on a free private display (`:90`+) with a private D-Bus session and runtime dir. Arch/CachyOS: `sudo pacman -S xorg-server-xvfb xdotool`; Debian/Ubuntu: `sudo apt install xvfb xdotool python3-gi gir1.2-atspi-2.0 at-spi2-core`.
- **Observation.** AT-SPI through libatspi; X11 extents are screen coordinates, so bounds are `exact`.
- **Actions.** AT-SPI first: `Action` (click/press/activate), `EditableText.set_text_contents`, `Value`, `Selection` (combo boxes and lists), `Component.grab_focus`/`scroll_to`, `Text.set_selection`. XTest through xdotool is the fallback and the route for coordinate clicks, typing and keys (text goes on stdin, never on the command line).
- **Screenshots** via XShm (python-mss), else ImageMagick `import`, else `ffmpeg -f x11grab`. **Recording** with `ffmpeg -f x11grab` into the run folder (`video.mp4`). A recording is removed if a secret was typed into a visible field.
- **Live view (optional).** `--vnc-port 6080` starts x11vnc + noVNC and publishes it on `127.0.0.1:6080` only (`http://127.0.0.1:6080/vnc.html?autoconnect=1`). The container then gets a bridged network, because Docker cannot publish ports with `--network none`. To watch from another tailnet device: `tailscale serve --bg --https=<free port> http://127.0.0.1:6080`, and `tailscale serve --https=<port> off` afterwards.
- **Accessibility flags.** Apps start with `GTK_MODULES=gail:atk-bridge`, `NO_AT_BRIDGE=0`, `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`, `QT_ACCESSIBILITY=1`, `ACCESSIBILITY_ENABLED=1`, `GNOME_ACCESSIBILITY=1`. Chromium, Chrome, Electron and VS Code get `--force-renderer-accessibility` (plus `--no-sandbox` inside the container, which is the sandbox). Tk apps expose no AT-SPI tree, which is why the testbed is GTK3.

## GNOME Wayland sandbox

`mutter --headless --wayland --no-x11 --virtual-monitor 1280x800` in a private `dbus-run-session`, with a private `XDG_RUNTIME_DIR` and its own PipeWire (and WirePlumber). Input goes through `org.gnome.Mutter.RemoteDesktop` on that private bus: no consent prompt, no portal, nothing on your session bus. Screenshots come from a Mutter ScreenCast stream read with GStreamer `pipewiresrc`. Needs `mutter`, `python3-gobject`, `at-spi2-core`, and for screenshots `pipewire` and `gst-plugin-pipewire`.

Pitfalls handled, from `docs/research/notes/desktop-inspiration.md`: AT-SPI extents are window-relative on Mutter, so bounds are `none` (untrusted) and token clicks are refused (actions stay semantic); letters and digits go as evdev keycodes because Mutter drops keysyms missing from the layout; every press is released; the session is warmed up with no-op motions (Mutter 50.2/50.3 drop the first pointer events); input is serialized.

Driving your own GNOME session (portal RemoteDesktop with `persist_mode=2` and a restore token on `SelectDevices`, libei through `ConnectToEIS`) is not built; the launcher refuses it.

## Windows (UIA)

Build once (needs the .NET 8 SDK): `dotnet publish packages/driver-desktop/hosts/windows/GhostHand.UiaHost -c Release -o packages/driver-desktop/hosts/windows/GhostHand.UiaHost/bin/publish`. Or point `GHOSTHAND_UIA_HOST` at the exe. Run with `ghosthand run --surface windows --allow-host-desktop --app notepad.exe "<goal>"`.

UI Automation patterns first: Invoke (with a 2 s watchdog, since Invoke can block behind a modal dialog), Value.SetValue, Toggle, SelectionItem, ExpandCollapse, ScrollItem, Text. `SendInput` is the fallback (Unicode typing, every key released). The process is per-monitor v2 DPI aware, so UIA rectangles and `SendInput` use the same physical pixels (`boundsTrust: exact`). Packaged apps that relaunch under another process (the new Notepad) are adopted by their new window. Recording uses `ffmpeg -f gdigrab` when ffmpeg is on PATH. The doctor flags Session 0 (no interactive desktop).

## macOS (AX)

Build once (needs Xcode or the Swift toolchain): `swift build -c release --package-path packages/driver-desktop/hosts/macos`, or set `GHOSTHAND_AX_HOST`. Grant your terminal Accessibility (and Screen Recording for screenshots) in System Settings > Privacy & Security. Run with `ghosthand run --surface macos --allow-host-desktop --app TextEdit "<goal>"`.

AX actions first (`AXPress`, `AXConfirm`, `AXPick`, settable `AXValue`, `AXSelected`, `AXFocused`, `AXSelectedTextRange`); pop-up buttons open their menu and press the item. `CGEvent` is the fallback. AX frames and CGEvents use global points with a top-left origin; screenshots are pixels, so the capture scale is the backing scale factor and capture pixels map back to points by dividing by it. Recording is not implemented on macOS.

## The RPC contract in brief

| Method | Purpose |
|---|---|
| `hello` | protocol version, platform, capabilities (semantic, pointer, screenshots, recording, bounds trust, live view URL), screen size and scale |
| `doctor` | host-side checks |
| `launch` | start an app with the accessibility flags and wait for its accessible window |
| `observe` | the app's (or desktop's) accessible nodes with native facts; `transient` reads keep the latest snapshot |
| `act` | `press`, `set_value`, `toggle`, `select_option`, `focus`, `scroll_into_view`, `select_text` on a ref of the latest snapshot, with before/after read-backs |
| `input` | `click`, `move`, `drag`, `scroll`, `type`, `key` in screen units, with window/focus read-backs |
| `screenshot`, `wait_idle`, `record_start`, `record_stop`, `close` | capture (`maxSide`, `format`, `quality` downscale and re-encode for the decision model, ADR 0020; `scale` reports pixels per screen unit), settle, video, shutdown |

A new host only has to implement these methods. `node scripts/desktop-host-smoke.ts --host <binary> [--app <cmd>] [--strict] [-- args]` checks one.
