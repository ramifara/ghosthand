# Desktop computer-use: inspiration notes (2026-09-30)

Scope: design a cross-platform `Computer` backend interface for our own testing agent.
Stage 1 is web (Playwright). Later stages are Linux (GNOME 50 Wayland host plus X11/XFCE containers), then Windows, then macOS.
A text-only chooser (TypeSafe Jev: yes/no, choose one of up to 255, rubric score) picks from an element table. A hosted vision model grounds coordinates as a fallback.

The references were shallow-cloned into `research/refs/<name>` (all paths below are relative to that directory):
- `cua`
- `computer-use-linux`
- `claude-quickstarts`
- `Agent-S`
- `openai-agents-python`
- `gnome-ponytail-daemon`
- `dogtail`
- `pywinauto`
- `atomacos`
- `macapptree`

Nothing was installed or run.

Host facts, read-only checks on this machine:
- GNOME Shell 50.4 on Wayland.
- `org.gnome.desktop.interface toolkit-accessibility` = `false`, so apps may not expose AT-SPI until it is enabled and the apps are restarted.
- The session bus has `org.a11y.Bus`, `org.freedesktop.portal.Desktop`, `org.gnome.Mutter.RemoteDesktop`, `org.gnome.Mutter.ScreenCast` and `org.gnome.Shell.Screenshot`.
- Installed: libei 1.6.0, xdg-desktop-portal-gnome 50.0, at-spi2-core 2.60.6, python-gobject 3.56.
- `/dev/uinput` is `crw------- root`, so ydotool/uinput paths need root or a udev rule.
- No xdotool or ydotool on the host. Docker is available.

---

## 1. trycua/cua: Python/TS `Computer` SDK and computer-server

### Interface
`cua/libs/python/computer/computer/interface/base.py` is abstract. `interface/generic.py` is the only real implementation; the per-OS classes are empty subclasses.

The methods are all async, and most take `delay: Optional[float]`:

- **Mouse:** `mouse_down/up(x=None,y=None,button="left")`, `left_click`, `right_click`, `double_click`, `move_cursor(x,y)`, `drag_to(x,y,button,duration=0.5)`, `drag(path: List[Tuple[int,int]], ...)`.
- **Keyboard:** `key_down/key_up/press_key/hotkey(*keys)/type_text(text)`.
- **Scroll:** `scroll(x,y)`, where x and y are wheel deltas ("positive = up, negative = down") and not a position. Also `scroll_up/scroll_down(clicks)`.
- **Screen:**
  - `screenshot(boxes=None, box_color="#FF0000", box_thickness=2, scale_factor=1.0) -> bytes`
  - `get_screen_size() -> {"width","height"}`
  - `get_cursor_position()`
- **Clipboard and files:** `copy_to_clipboard`, `set_clipboard`, plus chunked file ops (`read_bytes(path, offset, length)`, `write_bytes`, …).
- **Shell:** `run_command -> CommandResult(stdout, stderr, returncode)`.
- **Apps and windows:** `open`, `launch(app,args)->pid`, `get_current_window_id`, `get_application_windows`, `set_window_size/position`, `maximize/minimize/activate/close_window`.
- **Accessibility:** `get_accessibility_tree() -> Dict`.
- **Coordinates:** `to_screen_coordinates(x,y)` and `to_screenshot_coordinates(x,y)`.

`Key` enum and `MouseButton = Literal["left","right","middle"]` are in `interface/models.py`.

### Wire protocol
- `libs/python/computer-server/computer_server/main.py` accepts `POST /cmd {"command","params"}` (SSE `data:` reply) and `WS /ws`, with an `authenticate` first message.
- The reply is `{"success": True, **result}` or `{"success": False,"error"}`.
- The handlers dict is at `main.py:392`. Aliases include `"click"→"left_click"`.
- Handlers are chosen per OS in `handlers/factory.py` via `CUA_BACKEND=native|vnc|cua-driver`.

### Linux handler is a stub
`handlers/linux.py` uses pynput and PIL `ImageGrab`, which "works with X11/Xvfb".

Its accessibility tree is fake. The log line is `"Getting accessibility tree (simulated, no accessibility API available on Linux)"`, and it returns a single node:

```
{"role":"Window","title":"Linux Window","position":{x,y},"size":{w,h},"children":[]}
```

macOS (`handlers/macos.py:929`) has the only real tree (AX plus CGWindowList). Node shape:

```
{"id","name","role","description","value","position":"x;y","size":"w;h","bbox":[x0,y0,x1,y1],"visible_bbox":[..],"enabled","children"}
```

This is the macapptree schema. Windows is a one-level HWND class-name dump.

**Lesson:** shape drift across OSes. Their TS `AccessibilityNode{role,title?,value?,description?,bounds?}` matches no server.

### Scaling
`generic.py:711/751` does the conversion client-side, costing a screenshot and a size call per conversion:

```
width_scale = screen_size["width"] / screenshot_width
```

- macOS downscales screenshots to 1920 max width.
- The Anthropic loop uses `RECOMMENDED_MAX_WIDTH = 1024`.
- The UI-TARS loop uses `smart_resize`.

### Success detection
None. Input client methods discard the result, e.g. `await self._send_command("left_click", {...})`. The agent takes a screenshot after `screenshot_delay=0.5`.

### Agent callbacks
`libs/python/agent/cua_agent/callbacks/base.py` hooks:
- `on_run_start/end/continue`
- `on_llm_start/end`
- `on_computer_call_start/end`
- `on_screenshot`
- `on_usage`
- `on_api_start/end`

Built-in callbacks:
- `ImageRetentionCallback` (N most recent images)
- `BudgetManagerCallback` (sums `response_cost`)
- `OperatorNormalizerCallback` (repairs model action dicts, e.g. `left_click`→`click` with button)
- `TrajectorySaverCallback`
- `PIIAnonymizationCallback`, which is a TODO stub

Safety checks are auto-acknowledged (`agent.py:807`, `# TODO: implement a callback for safety checks`).

### Trajectory format
`TrajectorySaverCallback` writes this layout:

```
<dir>/<date>_<model>_<time>_<id>/
  metadata.json
  turn_000/
    0000_api_start.json
    api_result.json
    agent_response.json
    computer_call_result.json
    screenshot_after.png
    screenshot_action.png   # crosshair at x,y
```

`computer/tracing.py` is "inspired by Playwright's tracing". It writes `event_000001_<type>.json {type,timestamp,relative_time,data}` plus PNGs and `trace_metadata.json`, zipped. `video` is declared but unused.

### Cua Bench
`libs/cua-bench/cua_bench/`. Tasks are Python modules with these decorators:
- `@cb.tasks_config`
- `@cb.setup_task`
- `@cb.evaluate_task -> list[float]`
- `@cb.solve_task` (oracle)

Evaluation is programmatic state inspection, not a VLM judge. Examples:
- `session.execute_javascript(pid,"window.__clicked")`
- WinArena getters (`run_command`/`read_text`) combined with metrics
- `success = reward >= 0.5`

Traces are an HF `datasets.Dataset` with `step:before`/`step:after` rows.

Action dataclasses are in `types.py`: `ClickAction`, `DragAction(from,to,duration)`, `ScrollAction(direction, amount)`, `HotkeyAction`, `DoneAction`, `WaitAction`.

There is a bug in `computers/remote.py:600`: it passes screen-centre values as scroll deltas.

### Containers
`libs/xfce/Dockerfile`:
- Base `kicad/kicad:9.0` (!).
- `DISPLAY=:1`, `VNC_RESOLUTION=1024x768`.
- Installs xfce4, tigervnc-standalone-server, gnome-screenshot, wmctrl, ffmpeg, xclip, firefox-esr.
- supervisord runs vnc, novnc (6901) and computer_server (8000).
- `start-vnc.sh`: `vncserver :1 ... -SecurityTypes None --I-KNOW-THIS-IS-INSECURE`.
- `xstartup.sh`: `xset s off; xset -dpms`.
- `resize-display.sh`: `xrandr --output VNC-0 --mode`.

`libs/kasm` is based on KasmVNC. `libs/qemu-docker/{linux,windows,android}` is QEMU in Docker with computer-server inside the guest on :5000 and web VNC on :8006.

---

## 2. cua-driver / cua-driver-rs (the serious native backend)

Root: `cua/libs/cua-driver`. The Rust crates are in `rust/crates/`:
- `cua-driver-core`
- `cua-driver-contract`
- `platform-{linux,macos,windows}`
- `cua-driver-uia`
- `cua-perception`

The agent docs, which are the best reading, are `rust/Skills/cua-driver/{SKILL,WORKFLOW,RUNTIME,LINUX,WINDOWS,MACOS,RECORDING}.md`.

### Surfaces and contract
The driver is exposed as MCP stdio, a CLI (`cua-driver <tool> '<json>'`), and a UniFFI SDK over a C ABI.

`contract/manifest.json` is generated from `cua-driver-contract/src/*.rs`. It declares:
- `contract_version 0.8.0`
- per-tool `platforms`, `capabilities` (e.g. `accessibility.element_tokens`, `input.delivery_mode`), `annotations` (read_only/destructive/idempotent) and schemas

Portable tools:
- `start_session`, `end_session`
- `list_apps`, `list_windows`
- `get_window_state`, `get_desktop_state`
- `click`, `drag`, `scroll`, `move_cursor`, `type_text`, `press_key`, `hotkey`
- `set_window_frame`, `invoke_menu`
- `verify_state`
- `clipboard_read/write`
- `parse_visual_regions`

Runtime-only tools:
- `set_value`, `launch_app`, `bring_to_front`
- `get_accessibility_tree`, `check_permissions`, `health_report`
- `zoom`
- `browser_*` (CDP)
- `start_recording`/`stop_recording`, `replay_trajectory`

### Target and position unions
`cua-driver-contract/src/inputs.rs:630`:

```rust
pub enum ClickPosition {
    Coordinates { x: f64, y: f64 },
    Element { element_token: String },
    CapturedCoordinates { x: f64, y: f64, capture_id: String },
}
```

- `target` is `{kind:"window",pid,window_id}` or `{kind:"desktop",display_id:"primary"}`.
- `delivery_mode` is `background` (the default) or `foreground`.
- "desktop clicks require delivery_mode:"foreground"".

### Observation
`get_window_state(pid, window_id, query?, include_accessibility_tree, include_screenshot, max_elements, max_depth, max_image_dimension, timeout_ms)` returns:
- `snapshot_id`, `tree_markdown`, `elements[]`
- `elements_complete`, `degraded`, `truncated`
- `screenshot_width/height/scale`, `window_bounds`

Each entry in `elements[]` is a `WindowElement`:

```
{element_index, role, depth, element_token, label, value, value_description, enabled, selected, in_web_content, actions[], parent_index, frame{x,y,w,h}, min, max}
```

### Element tokens
`cua-driver-core/src/element_token.rs` and `snapshot_store.rs`:
- Token format is `s<8hex snapshot>:<index>`.
- `LRU_CAP_PER_PID: usize = 8`.
- A new snapshot for the same (pid, window) retires the old one and reports `invalidated_snapshot_ids`.
- Stale token error: `"element_token is stale; call get_window_state again to refresh"`, with refusal code `stale_element_token`.
- The native handle is cached in the snapshot:
  - macOS: raw `AXUIElementRef`.
  - Windows: `IUIAutomationElement` or `IAccessible` COM pointer.
  - Linux: AT-SPI (bus name, object path).
- Linux comment: "Re-walking large trees (LibreOffice, GIMP, Nautilus) was the multi-second stall behind every element-index click."

`capture_id` (`capture_registry.rs`, RFC 3931) is a one-use screenshot binding: "a region-derived pixel click must carry the same one-use `capture_id` as the observation". **Adopt this for vision fallback.**

### Roles are NOT normalized
`cua/rfcs/4268-jev-use-native-candidates.md:236`: "**Finding: `elements[].role` values are not normalized.** Each adapter writes its native role string directly."

Native role strings per platform:
- macOS: `AXButton`
- Windows: `Button`/`Edit`
- Linux: `push button`/`entry`

Label fallbacks differ per platform:
- macOS: title→description→value→identifier
- Windows: name→value→automation id→help text
- Linux: name→description, plus `unlabelled:true`

`core/src/expectation.rs:686 normalized_role` only lowercases, strips `ax` and maps `pushbutton→button`.

### RFC 4268: "Native accessibility candidates for jev-use decision loops"
Created 2026-09-27, status completed. This is the closest thing to our design. The flow:
- The app builds every complete action.
- Jev "returns one supplied ID".
- The driver acts.
- An independent oracle verifies.

The role-class table (RFC lines 440-460):

| role class | AX | UIA | AT-SPI | action |
|---|---|---|---|---|
| button | AXButton | Button, SplitButton | push button, button | press |
| checkbox | AXCheckBox, AXSwitch | CheckBox | check box, toggle button | toggle |
| radio | AXRadioButton | RadioButton | radio button | select |
| popup | AXPopUpButton, AXComboBox, AXMenuButton | ComboBox | combo box | open_menu |
| menu_item | AXMenuItem, AXMenuBarItem | MenuItem | menu item, check/radio menu item | press |
| link | AXLink | Hyperlink | link | press |
| text_entry | AXTextField/TextArea/SearchField/SecureTextField | Edit | entry, text, password text | set_text |

Pitfall: "Linux AT-SPI `text` is an editable text control, while Windows UIA `Text` is static text" (`libs/cua-driver/examples/jev-use/python/native_roles.py`).

Candidate filter:
- enabled
- frame intersects `window_bounds`
- has a label that is not a copy of its value (so typed content never becomes an ID)
- not `in_web_content`
- allowed by the task and the risk policy

Stable IDs:

```
base = "ax:" + role_class + ":" + slug(label)
id   = base  (if unique)  else  base + ":" + hex4(sha256(actionable-ancestor path, ord))
```

`element_index` is rejected as an ID ("invites the chooser to learn positional shortcuts").

Rules:
- "Each observation authorizes at most one action, then the runner reobserves."
- A stale ID is never remapped to a new token without a new decision.
- Reserved candidates are `reobserve` and `abstain`.
- A `<id>:foreground` candidate is offered only after a background refusal.
- The risk tags are `destructive|send|purchase|close_unsaved`, matched on labels. Tagged candidates are removed unless the task's `allowed_risks` includes the tag.

Request and response schemas are `cua.jev_choice_request_v2` and `cua.decision_choice_v1`. The response carries `selected_id`, `confidence` and `probabilities`.

Results at about 24 candidates: Jev scored 35/35 correct on macOS and Linux, with a decide median of about 200-240 ms.

### Action result contract
`libs/cua-driver/docs/action-result-contract.md`:
- `effect: confirmed | partial | unverifiable | suspected_noop | refused`
- `route`
- `delivery.mode`
- `evidence[].kind: value_readback | window_change`
- `escalation{target: pixel|foreground|page|session, reason}`

Rule: "Screenshot change, native API acceptance, event receipt… do not independently justify `confirmed`."

`verify_state` takes 1-8 ANDed predicates:
- `window{exists,bounds±tol}`
- `element{selector{role,label_contains}, exists, value_equals, enabled, selected}`

It supports `timeout_ms` and `stable_samples`, and returns `satisfied|unsatisfied|unknown` with an `unknown_reason`. "`unknown` never implies success."

### Per-OS input and capture

**macOS:**
- Semantic: AXPress/AXConfirm/set value.
- Background pixel input: SkyLight `SLEventPostToPid` ("public `CGEventPostToPid` skips the activity-monitor tickle so Chromium/Catalyst targets don't accept those events").
- Capture: ScreenCaptureKit, with `screencapture -l` as fallback.

**Windows:**
- Element click: UIA `InvokePattern.Invoke()`, then `PostMessage`.
- Pixel click: UIA hit-test, then synthetic pointer injection, then PostMessage.
- Known silent drops are refused (`would_be_silently_dropped`: Chromium, GTK, WPF text).
- Foreground: `SendInput` plus a brief `SetForegroundWindow`.
- Capture: `PrintWindow(PW_RENDERFULLCONTENT)`, falling back to WGC when the result is black.
- DPI: per-monitor-v2 manifest.

**Linux X11:**
- AT-SPI via zbus.
- XSendEvent.
- A background "second master pointer" via XInput2 MPX fed by uinput.
- Foreground via XTest.
- Capture: MIT-SHM `XGetImage`. Video: ffmpeg `x11grab`.

**Linux Wayland** (`CUA_DRIVER_RS_ENABLE_WAYLAND=1`):
- wlroots: `zwlr_screencopy` and `virtual_pointer`.
- GNOME: the `winrects@cua` Shell extension (`wayland-helper/`) exposes `org.cua.WinRects.GetRects/Activate/Capture`, because "AT-SPI's `CoordType::Screen` is `(0,0)` for every widget on Mutter". Input is portal RemoteDesktop plus libei (`reis`), foreground only, with the restore token at `~/.config/cua-driver/libei-persistent.token`.
- KDE: raw input refused ("focus-bound").
- Hyprland: a C++ plugin with a second compositor seat.
- LINUX.md: "Standard Wayland has no general client protocol for raw input to an arbitrary occluded surface."

### Coordinates
`core/src/element_frame.rs`: "`frame` is the element's rectangle in screen coordinates on every platform… `screenshot_frame` is the same rectangle in pixels of the window screenshot".

- The scale is "delivered screenshot pixels per screen unit".
- Screenshots are capped at ≤1.15 MP, with long edge 1568.
- Window-target x,y are window-screenshot pixels: "do not add window offsets to window-local input".
- Only `display_id:"primary"` is portable. Other displays are "reject[ed] explicitly rather than silently changing coordinate spaces".
- On macOS, a 1x/2x mismatch yields `px_frame_mismatch` and the pixel frame is omitted rather than guessed.

### Safety
- Daemon permission modes are `standard|bounded|unrestricted`, fixed at startup.
- A YAML/Rego deny-by-default policy file (`core/src/policy.rs`) supports `allow.tools` and argument constraints.
- `cua-driver doctor` prints `[ok]/[warn]/[err]` for Session 0/UIA, `DISPLAY`/`WAYLAND_DISPLAY`/a11y bus, and TCC.
- The skill docs forbid `xdotool windowactivate`, `wmctrl -a`, `osascript activate`.

### Recording
`RECORDING.md` describes `turn-NNNNN/` folders containing:
- `before_state.json` / `after_state.json`
- `before.png` / `after.png`
- `action.json`
- `click.png` with a marker
- `evidence.json`

Video uses SCRecordingOutput, gdigrab or x11grab. `replay_trajectory` "is not a semantic task planner".

### Useful harness fixtures
`cua/libs/cua-driver-fixtures/*.html` and `libs/cua-driver/tests/fixtures/` (WPF, WinUI3, AppKit and GTK apps). `docs/action-support.md` is a per-OS ledger of which actions were delivered and which were refused.

---

## 3. agent-sh/computer-use-linux (Rust MCP, GNOME Wayland)

### Input
Input goes through the xdg portal RemoteDesktop over zbus (`src/remote_desktop.rs:145`):
1. `CreateSession`
2. `SelectDevices`
3. ScreenCast `SelectSources(types=MONITOR, cursor_mode=HIDDEN)`
4. `Start`

Events are then sent with `NotifyPointerMotionAbsolute(session, opts, stream_node_id, x, y)`, `NotifyPointerButton`, `NotifyPointerAxisDiscrete`, `NotifyKeyboardKeysym/Keycode`. It does not use libei.

Pointer and keyboard use separate portal sessions.

Restore tokens are opt-in (`COMPUTER_USE_LINUX_PERSIST_REMOTE_DESKTOP=1`), with `PERSIST_MODE_UNTIL_REVOKED = 2`, stored as a 0600 file under `$XDG_STATE_HOME`. Pitfall at `remote_desktop.rs:1750`: "persist_mode or restore_token here makes the portal reject the call: 'Remote desktop sessions cannot persist'". Persistence belongs on `SelectDevices`.

### GNOME 50 scaling pitfall
CHANGELOG:79: "mutter maps a stream point to `monitor.x + stream_x / scale` when its layout mode is logical, which is the GNOME 50 default."

The fix reads `org.gnome.Mutter.DisplayConfig.GetCurrentState` `layout-mode` and multiplies by the per-stream `pixel_scale`. `ensure_current_layout()` invalidates the session when monitors change.

### Keys
`server.rs:5759`: "Letters and digits stay physical keycodes: mutter drops a keysym missing from the current layout group". Modifiers and named keys are sent as keysyms.

- A 35 ms hold between press and release.
- `PointerReleaseGuard` and `KeyboardReleaseGuard` release on drop.
- A global input lock.

### Fallbacks
- `abs_pointer.rs` creates a uinput ABS device ("ydotool's virtual device is relative-only … distorts with pointer acceleration and fractional display scaling").
- Then ydotool, wtype, xdotool.
- Default: ydotool is preferred "because it injects input without a permission prompt".

### Screenshots
`screenshot.rs:180`: `org.gnome.Shell.Screenshot`, then portal Screenshot `interactive=false`, then X11 `GetImage`, then the `gnome-screenshot` CLI.

Pitfall: "GNOME Shell's DBusSenderChecker rejects unknown bus names, and the portal cancels with response code 2 when there is no foreground window."

Output is capped at 1920 px and 2 MiB, and returns `coordinate_width/height` and `scale`.

### AT-SPI
`src/atspi_tree.rs`:
- `get_extents(CoordType::Screen)`.
- Caps of 1000 nodes, depth 32 and a 10 s timeout.
- The selector is `ElementSelector{role,name,text,states[]}` with case-insensitive, whitespace-normalized substring matching. On ambiguity: "matched multiple cached nodes ... Pass element_index".
- A left click on an element uses the native action (`click`/`press`/`toggle`) because "Toolkit extents are not necessarily in the pointer backend's space (GTK3 X11 HiDPI, GTK4 zero-origin bounds)".
- `server.rs:3403`: "window bounds ... and the extension monitor layout are in LOGICAL pixels, while click/scroll coordinates and screenshot captures are in PHYSICAL capture pixels."

### Window geometry
It ships a GNOME Shell extension (`gnome-shell-extension/computer-use-linux@avifenesh.dev/extension.js`) with `ListWindows`, `ActivateWindow(t)`, `MoveWindow`, `ResizeWindow`, `GetMonitorLayout`, because `org.gnome.Shell.Introspect` is denied to unapproved callers.

### doctor
`src/diagnostics.rs` covers:
- portals, checking per-method exports ("`busctl introspect` exits 0 ... for an interface the portal does not export")
- Mutter bus names
- a11y `IsEnabled`
- window backends
- `/dev/uinput`
- ydotool ≥ 1.0.3

It reports readiness flags `can_build_accessibility_tree/can_query_windows/can_send_development_input/can_capture_screenshots`, plus `blockers[]` and `recommended_next_step`.

### Documented pitfalls
From README and `skills/computer-use-linux/SKILL.md`:
- "Wayland pointer actions miss an unfocused window … Call `activate_window` before `click`".
- Apps must restart after enabling a11y.
- Electron needs `--force-renderer-accessibility`.
- The portal prompts on every new process without persistence.
- No concurrent calls.

### Safety
- MCP ToolAnnotations, checked in CI by `scripts/mcp_safety_check.py`.
- `run_shell` is gated by an env var.
- Element indices from one app's snapshot are refused for another pid.
- After typing it reports the focused element and warns when that element is not editable.

---

## 4. gnome-ponytail-daemon and dogtail

### gnome-ponytail-daemon
D-Bus API (`src/org.gnome.Ponytail.EventController.xml`), bus `org.gnome.Ponytail`, path `/org/gnome/Ponytail/EventController`:

```
ConnectWindow(t window_id)
ConnectMonitor(s connector)
Disconnect()
GenerateKeycodeEvent(u,b)
GenerateKeysymEvent(u,b)
GenerateButtonEvent(i,b)
GenerateMotionEvent(d x, d y)
```

The signals are `Connected`/`Disconnected`. The interface is "private ... No compatibility between versions are promised."

Mutter call sequence (`src/gpd-session.c`):
1. `org.gnome.Mutter.RemoteDesktop.CreateSession()`
2. `org.gnome.Mutter.ScreenCast.CreateSession({"remote-desktop-session-id": id})`
3. `RecordWindow({"window-id": u64})` or `RecordMonitor(connector)`
4. Wait for `PipeWireStreamAdded`
5. `Start()`
6. `NotifyPointerMotionAbsolute(stream_path, x, y)`

With a RecordWindow stream the coordinates are **window-surface-relative**. The README says it "will translate global coordinates into surface relative coordinates".

There is no portal prompt, because it uses Mutter's private API directly. The optional libei path (`gpd-ei-client.c`) calls `ConnectToEIS`, falling back to Notify* after 5 s. Note that its libei path has no per-region mapping.

The window list comes from `org.gnome.Shell.Introspect.GetWindows`. On GNOME 41+ this needs `global.context.unsafe_mode = true` (Looking Glass), which is not acceptable for a product.

Keycodes are XKB (evdev+8). README: "Make sure to send a release event for each press event!"

### dogtail
Wayland is detected with `XDG_SESSION_TYPE`. On Wayland input goes through ponytail (`dogtail/ponytail_helper.py`, `rawinput.py`):
- Mouse events connect to the node's window id.
- Keyboard events go to the monitor stream.
- Xwayland windows are forced to the monitor stream.
- If the target window is unfocused, it silently switches to the focused one.

Coordinates (`accessibles/accessible_component.py:239`): on Wayland GTK4 it uses `CoordType.WINDOW` plus `config.gtk4_offset=(12,12)` for the shadow. The README requires `window, .popover, .tooltip { box-shadow: none; }` in `~/.config/gtk-4.0/gtk.css` because "Offsets differ per application, size, and scaling."

`HERMETIC.md` rules:
- Rule 3: "A Wayland client is never told where the compositor put it. GTK thinks it's at `(0,0)`, AT-SPI repeats that … Injected clicks are screen-global."
- Rule 2: "`do_action_named()` first, always."
- Rule 1: one session per process.
- GTK4 nests a same-named `label` inside `button`, so pin `role_name`.

`dogtail/hermetic/mutter.py` handles headless `mutter --headless --virtual-monitor` with direct Mutter RemoteDesktop:
- Absolute moves are faked as a relative move to (-100000,-100000) followed by a relative move to the target.
- `BUTTON_MAP = {1: 272, 2: 274, 3: 273}`.
- "Mutter 50.2 and 50.3 eat the first three pointer events, six leaves headroom." It warms up with no-op events.

**This is a good recipe for a headless GNOME test session.**

Tree API worth copying (`tree.py`, `predicate.py`):
- Search: `child(name, role_name, description, label, identifier, recursive, showing_only, retry)`, `find_child(predicate)`, `find_children`, `find_ancestor`.
- `GenericPredicate` does exact matching.
- Retry: `search_cut_off_limit=20` × `search_back_off_delay=0.5`, then `SearchError`.
- States: `showing, visible, sensitive, focused, checked, selected, editable, read_only, pressed, collapsed`.
- Actions: `do_action_named`, `grab_focus`, `scroll_to`, `get_accessible_at_point`.

---

## 5. anthropics/claude-quickstarts computer-use-demo

### Tool versions
Defined in `computer-use-demo/computer_use_demo/tools/computer.py`:
- `Action_20241022`: key, type, mouse_move, left_click, left_click_drag, right/middle/double_click, screenshot, cursor_position.
- `20250124` adds: left_mouse_down/up, scroll, hold_key, wait, triple_click.
- `20251124` adds: zoom.
- `ComputerToolset20260801` makes each action a member tool. `key` gains `repeat` (1-100), modifiers go in `text`, and there are no display params.

### Constants and scaling
```
TYPING_DELAY_MS = 12
TYPING_GROUP_SIZE = 50
_screenshot_delay = 2.0
MAX_SCALING_TARGETS = {XGA 1024x768, WXGA 1280x800, FWXGA 1366x768}
```

`scale_coordinates(source, x, y)` picks the target with the same aspect ratio (within 0.02) that is smaller than the screen. For `API→screen` it computes `round(x / factor)` after a bounds check (`ToolError("Coordinates … out of bounds")`).

Zoom crops the region from a full-resolution capture, and "the zoom image itself is never a coordinate frame".

### Screenshot and input
- Screenshot: `gnome-screenshot -f p -p`, else `scrot -p`, then `convert -resize WxH!`.
- Input: xdotool with `mousemove --sync`, `click --repeat N 4|5|6|7` for scroll, `type --delay 12 -- chunk`.
- Every action returns a screenshot after 2 s.
- `ToolResult(output, error, base64_image, system)` is in `tools/base.py`.

### Loop
`loop.py`:
- Prompt caching on the last 3 user turns.
- `only_n_most_recent_images` truncation in chunks (`min_removal_threshold`) to limit cache breakage.
- Toolset mode fails fast: "Not executed: an earlier computer action in this turn failed."

### Docker
Base `ubuntu:22.04` with `xvfb xterm xdotool scrot imagemagick mutter x11vnc tint2 firefox-esr libreoffice`.

`image/xvfb_startup.sh`:

```
Xvfb $DISPLAY -ac -screen 0 ${WIDTH}x${HEIGHT}x24 -retro -dpi 96 -nolisten tcp -nolisten unix
```

- The window manager is `XDG_SESSION_TYPE=x11 mutter --replace --sm-disable`.
- `x11vnc -forever -shared -rfbport 5900 -nopw`.
- noVNC on 6080.
- `WIDTH=1024 HEIGHT=768 DISPLAY_NUM=1`.

### README safety
Dedicated VM or container, no credentials, a domain allowlist, and human confirmation for consequential actions. It also warns about prompt injection from on-screen content. On resolution: stay at or below XGA/WXGA, scale down, and pad to 1024x768.

---

## 6. Agent-S (grounding split, ACI)

### s3
The planner and the grounder are separate models.

- `gui_agents/s3/agents/worker.py`: the generator emits a code block such as `agent.click("the blue Submit button")`. A reflection agent comments on the trajectory. Format checkers re-prompt with "There must be a single agent action".
- `gui_agents/s3/agents/grounding.py`: `OSWorldACI` methods are tagged `@agent_action`:

  ```
  click(element_description, num_clicks, button_type, hold_keys)
  type(element_description, text, overwrite, enter)
  drag_and_drop(start_desc, end_desc)
  highlight_text_span(start_phrase, end_phrase)   # OCR via pytesseract + LLM picks word id
  scroll(element_description, clicks, shift)
  hotkey, hold_and_press, open, switch_applications   # wmctrl
  set_cell_values   # LibreOffice UNO
  wait, done, fail, call_code_agent
  ```

  Each method returns a pyautogui code string.
- Grounding prompt: `"Query:{ref_expr}\nOutput only the coordinate of one point in your response.\n"`. The rescale is `x * self.width / grounding_width`, e.g. UI-TARS-1.5-7B at 1920x1080 or 72B at 1000x1000.
- Non-ASCII text is typed through the clipboard paste path.

**Lesson:** describe elements in natural language for the vision fallback, and keep the grounding frame explicit.

### s1
The accessibility-tree ACIs are in `gui_agents/s1/aci/`:
- **LinuxOSACI** (pyatspi → lxml):
  - The tag is the role with dashes.
  - States go in `st:` attributes.
  - Bounds use `getExtents(XY_SCREEN)` and are read only when showing.
  - Excluded roles: `panel, window, filler, frame, separator, scroll-bar`.
  - Output is linearized to TSV `id\ttag\tname\ttext`.
  - OCR boxes with IoU<0.1 against tree boxes are added as `push-button`.
- **MacOSACI**: excludes `AXGroup, AXLayoutArea, AXLayoutItem, AXUnknown`.
- **WindowsOSACI** (pywinauto uia): excludes `Pane, Group, Unknown`.

Actions take an `element_id` and click the centre of the bounds.

**Safety:** `cli_app.py` calls `exec`s model-produced pyautogui code. `show_permission_dialog` is defined but never called. Do not copy.

---

## 7. openai-agents-python `Computer` / `AsyncComputer`

In `src/agents/computer.py`:

```python
Environment = Literal["mac", "windows", "ubuntu", "browser"]
Button = Literal["left", "right", "wheel", "back", "forward"]
```

Properties: `environment`, `dimensions -> tuple[int,int] | None`.

Abstract methods:
- `screenshot() -> str` (base64 PNG)
- `click(x,y,button)`, `double_click(x,y)`
- `scroll(x,y,scroll_x,scroll_y)`
- `type(text)`, `wait()`, `move(x,y)`
- `keypress(keys: list[str])`
- `drag(path: list[tuple[int,int]])`

Mouse methods may accept keyword-only `keys` for held modifiers; this is filtered by signature.

`ComputerTool(computer | ComputerProvider(create, dispose), on_safety_check)` is in `src/agents/tool.py`. For each `pending_safety_checks` entry, `on_safety_check(data)` must return True, otherwise `UserError("Computer tool safety check was not acknowledged")`.

Every batch ends with one screenshot sent as `computer_screenshot`.

**Lesson:** this is the minimal pixel interface. Our interface should be a superset with the same verbs.

---

## 8. Windows and macOS accessibility libraries

### pywinauto
**Backend model.** `backend.py register(name, element_info_class, wrapper)` pairs an ElementInfo class with a Wrapper class. Backends are win32, uia, wpf, and linux atspi.

**`UIAElementInfo` fields** (`windows/uia_element_info.py`): `name, control_type, class_name, auto_id, runtime_id ("may be different from run to run"), rectangle (RECT, physical px), process_id, handle, enabled, visible, framework_id, value, access_key, accelerator, legacy_*`.

**Query props.** Regex-capable: `re_props = ["class_name","name","auto_id","control_type",...,"value"]`. Exact-only: `exact_only_props = ["handle","pid","enabled","visible","rectangle","runtime_id"]`.

**Semantic vs real input**, which should be two distinct verbs:
- `invoke()` uses InvokePattern with a 2 s watchdog thread ("sometimes .Invoke() can hang").
- `set_edit_text` uses ValuePattern.SetValue.
- `click_input()` uses SendInput and "requires the control to be visible".
- win32 `click()`/`send_chars` use WM_* messages that work "in an inactive window".

**DPI.** The process is made per-monitor DPI aware on import (`win32functions.py:795`).

**Timings.** `window_find_timeout 5`, `after_click_wait .09`. `wait('exists'|'visible'|'enabled'|'ready'|'active')` is deprecated in favour of `find().wait_*`.

**Matching.** `findbestmatch.find_best_match(..., limit_ratio=.5)` does fuzzy name matching with difflib.

### atomacos
- `_a11y.py AXUIElement` exposes attributes dynamically (`AXRole, AXTitle, AXPosition, AXSize, AXChildren, AXEnabled, AXFocused`). `AXPosition` converts to a `CGPoint` in global points with a top-left origin.
- Search: `findFirst(AXRole='AXButton', AXTitle='Close')` with glob matching; `findAllR` for recursion.
- Waiting uses notifications: `waitFor(timeout, notification)`, `waitForValueToChange`, `waitForWindowToAppear`.
- Input is just pyautogui re-exported (global, frontmost only). Actions call `activateWithOptions_(3)`, which steals focus.
- Permission: `AXIsProcessTrusted()`. Without it, calls raise `AXErrorAPIDisabled`.

### macapptree
- `uielement.py to_dict()` produces `{id,name,role,description,role_description,value,absolute_position:"x;y",position,size,enabled,bbox,visible_bbox,visible,children}`. Positions are window-relative points; `absolute_position` is the screen position.
- `visible_bbox` is clipped by the parent. Window occlusion is computed front to back from CGWindowList (`window_tools.py:186`).
- `scale_utils.get_image_scale_factor` returns 1.0 or 2.0 from the ratio of image pixels to points, falling back to `backingScaleFactor`.
- Screenshots use `screencapture -l <windowid> -o`.
- `AXChildren` is read with a cap of 999.
- Bug: `run.py` expects `croped_screenshot_path`.

---

## 9. Cross-cutting synthesis

### Coordinate spaces
There are at least four:
1. Physical capture pixels.
2. Logical/screen points: AX points, GNOME logical layout, UIA physical when the process is DPI-aware.
3. Window-local: ponytail RecordWindow, the cua-driver window target, macapptree bbox.
4. The model frame: XGA/WXGA downscale, or the grounder's frame such as 1000x1000.

Every reference that got this right carries an explicit scale and binds pixel coordinates to the capture they came from (cua `capture_id`, Anthropic's "zoom is never a coordinate frame"). On Wayland, AT-SPI screen extents are (0,0)-based and cannot be trusted. Prefer semantic actions, and otherwise use screenshot-relative pixels.

### Semantic first
All the mature projects prefer native actions (AXPress, UIA Invoke/SetValue, AT-SPI do_action/EditableText) over synthetic pointer input:
- "`do_action_named()` first, always" (dogtail).
- computer-use-linux clicks elements through native actions.
- cua-driver uses its routing ladder.

Pointer input is the fallback.

### Success detection
The good design is cua-driver's `effect` plus `evidence`, together with `verify_state` predicates and a tri-state result.

Most projects (cua SDK, Anthropic, OpenAI, Agent-S) only return a screenshot. Bench-style oracles inspect state programmatically.

### Safety
The recurring elements:
- A container or VM.
- A deny-by-default tool policy.
- Risk tags on candidates.
- Human confirmation hooks (OpenAI `on_safety_check`).
- Doctor or readiness checks.
- Release guards for held keys and buttons.
- One action per observation.
- An input lock (no concurrent input).

### Role vocabulary
No upstream normalizes roles well. Use the **ARIA/Playwright role vocabulary** as the canonical `role`, because Playwright already speaks it and AT-SPI roles are close to ARIA. Keep `native_role`. Keep a coarse `role_class` for the chooser, following RFC 4268.

---

## 10. Proposed interface (Python; TS mirror is mechanical)

```python
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, Protocol, Sequence, runtime_checkable

# ---------- geometry ----------
@dataclass(frozen=True)
class Rect:                       # always in the space named by `space`
    x: float; y: float; w: float; h: float

Space = Literal["capture_px", "screen_logical", "window_local", "css_px"]

@dataclass(frozen=True)
class Capture:
    capture_id: str               # one-use; pixel actions must cite it
    png: bytes
    width_px: int; height_px: int
    scope: Literal["page", "window", "screen", "region"]
    origin_logical: tuple[float, float]  # capture (0,0) in screen_logical (0,0 for page)
    scale: float                  # capture px per logical unit (DPR / HiDPI / downscale)
    taken_at_ms: int
    window: WindowRef | None = None

# ---------- targets ----------
@dataclass(frozen=True)
class AppRef:    id: str; pid: int | None; name: str; bundle_or_exe: str | None = None
@dataclass(frozen=True)
class WindowRef: id: str; app: AppRef; title: str; bounds_logical: Rect | None; focused: bool; minimized: bool = False

# ---------- elements ----------
RoleClass = Literal["button","checkbox","radio","popup","menu_item","link","text_entry",
                    "tab","slider","list_item","tree_item","cell","static_text","image",
                    "container","window","other"]

@dataclass(frozen=True)
class ElementStates:
    enabled: bool | None = None; visible: bool | None = None; focused: bool | None = None
    focusable: bool | None = None; editable: bool | None = None; checked: bool | Literal["mixed"] | None = None
    selected: bool | None = None; expanded: bool | None = None; pressed: bool | None = None
    readonly: bool | None = None; required: bool | None = None; invalid: bool | None = None

@dataclass(frozen=True)
class Element:
    token: str                    # "<snapshot_id>:<n>" - valid ONLY for this snapshot
    stable_id: str                # "button:save" (+":"+hash4 of ancestor path if duplicated) - for history/eval, never for acting
    role: str                     # canonical ARIA role ("button","textbox","checkbox","combobox","link","menuitem",...)
    role_class: RoleClass         # coarse bucket for chooser/risk policy
    native_role: str              # "push button" | "Button" | "AXButton" | "button" (aria)
    name: str                     # accessible name (label); redacted if secret
    description: str | None = None
    value: str | None = None      # redacted for password fields; never used in IDs
    value_range: tuple[float, float, float | None] | None = None  # min,max,step
    states: ElementStates = field(default_factory=ElementStates)
    actions: tuple[str, ...] = () # normalized: "press","toggle","select","expand","collapse","set_value","focus","scroll_into_view"
    native_actions: tuple[str, ...] = ()
    bounds: Rect | None = None    # screen_logical (css_px for web); None when untrusted (e.g. Wayland AT-SPI)
    bounds_trust: Literal["exact","window_relative","untrusted","none"] = "none"
    capture_bounds: Rect | None = None  # same rect in the paired Capture's pixels, if provable
    visible_bounds: Rect | None = None  # clipped by ancestors / occlusion
    parent: str | None = None; depth: int = 0
    in_web_content: bool = False
    automation_id: str | None = None    # UIA AutomationId / AT-SPI accessible_id / AXIdentifier / data-testid
    source: Literal["dom","ax","uia","atspi","ocr","vision"] = "ax"
    risk: frozenset[str] = frozenset()  # destructive|send|purchase|close_unsaved|...
    extra: dict[str, str] = field(default_factory=dict)

@dataclass(frozen=True)
class Snapshot:
    snapshot_id: str
    target: WindowRef | Literal["page","desktop"]
    elements: Sequence[Element]
    complete: bool                # False if truncated/timeout/degraded - absence is then "unknown"
    degraded_reason: str | None
    capture: Capture | None
    tree_text: str | None         # compact text rendering for LLMs (optional)

# ---------- actions & results ----------
Button = Literal["left","right","middle","back","forward"]
Delivery = Literal["semantic","background","foreground"]

@dataclass(frozen=True)
class ElementTarget: token: str
@dataclass(frozen=True)
class PointTarget:   x: float; y: float; capture_id: str          # pixels of THAT capture
@dataclass(frozen=True)
class ScreenPoint:   x: float; y: float                           # screen_logical, foreground only
Target = ElementTarget | PointTarget | ScreenPoint

Effect = Literal["confirmed","partial","unverifiable","suspected_noop","refused"]

@dataclass(frozen=True)
class Evidence: kind: Literal["value_readback","state_readback","window_change","focus_change","dom_mutation","navigation","pixel_diff"]; detail: str

@dataclass(frozen=True)
class ActionResult:
    effect: Effect
    route: str                    # "atspi.do_action", "uia.invoke", "ax.press", "portal.pointer", "xtest", "playwright.click"...
    delivery: Delivery
    evidence: tuple[Evidence, ...] = ()
    error_code: str | None = None # stale_token | not_actionable | background_unavailable | permission_denied | out_of_bounds ...
    hint: str | None = None
    invalidated_snapshots: tuple[str, ...] = ()
    capture_after: Capture | None = None

@dataclass(frozen=True)
class Predicate:                  # verify_state style; ANDed
    kind: Literal["element","window","url","text_present","focus"]
    role: str | None = None; name_contains: str | None = None
    exists: bool | None = None; value_equals: str | None = None
    enabled: bool | None = None; checked: bool | None = None; selected: bool | None = None
    window_title_contains: str | None = None; url_matches: str | None = None

@dataclass(frozen=True)
class VerifyResult: status: Literal["satisfied","unsatisfied","unknown"]; reason: str | None; snapshot_id: str

@dataclass(frozen=True)
class Capabilities:
    platform: Literal["web","linux-x11","linux-gnome-wayland","linux-wlroots","windows","macos"]
    semantic_actions: bool; background_input: bool; foreground_input: bool
    element_bounds_trusted: bool; window_list: bool; per_window_capture: bool
    set_value: bool; clipboard: bool; recording: bool; multi_display: bool
    max_choices_hint: int = 255

@dataclass(frozen=True)
class DoctorReport: ok: bool; checks: tuple[tuple[str, Literal["ok","warn","err"], str], ...]; blockers: tuple[str, ...]; next_step: str | None

# ---------- the backend protocol ----------
@runtime_checkable
class Computer(Protocol):
    # lifecycle / diagnostics
    async def start(self) -> None: ...
    async def close(self) -> None: ...
    def capabilities(self) -> Capabilities: ...
    async def doctor(self) -> DoctorReport: ...

    # discovery
    async def list_apps(self) -> list[AppRef]: ...
    async def list_windows(self, app: AppRef | None = None) -> list[WindowRef]: ...
    async def launch(self, app: str, args: Sequence[str] = (), *, url: str | None = None) -> AppRef: ...
    async def focus_window(self, window: WindowRef) -> ActionResult: ...
    async def close_window(self, window: WindowRef) -> ActionResult: ...

    # observation (one call = one snapshot = one capture)
    async def observe(self, target: WindowRef | Literal["page","desktop"] = "page", *,
                      elements: bool = True, screenshot: bool = True,
                      max_elements: int = 2000, max_depth: int = 40,
                      max_image_edge: int = 1568, timeout_ms: int = 2000) -> Snapshot: ...
    async def screenshot(self, target: WindowRef | Literal["page","desktop"] = "page",
                         region: Rect | None = None) -> Capture: ...     # region in capture_px of a prior capture => zoom

    # semantic element actions (preferred)
    async def press(self, el: ElementTarget) -> ActionResult: ...        # invoke/AXPress/do_action("click")/locator.click
    async def set_value(self, el: ElementTarget, text: str, *, secret: bool = False) -> ActionResult: ...
    async def toggle(self, el: ElementTarget, want: bool | None = None) -> ActionResult: ...
    async def select_option(self, el: ElementTarget, option: str) -> ActionResult: ...
    async def focus(self, el: ElementTarget) -> ActionResult: ...
    async def scroll_into_view(self, el: ElementTarget) -> ActionResult: ...

    # pointer/keyboard (fallback; Target decides coordinate space)
    async def click(self, t: Target, *, button: Button = "left", count: int = 1,
                    modifiers: Sequence[str] = (), delivery: Delivery = "background") -> ActionResult: ...
    async def move(self, t: Target) -> ActionResult: ...
    async def drag(self, path: Sequence[Target], *, button: Button = "left", duration_ms: int = 300) -> ActionResult: ...
    async def scroll(self, t: Target, *, dx: int = 0, dy: int = 0, unit: Literal["line","pixel","page"] = "line") -> ActionResult: ...
    async def type_text(self, text: str, *, into: ElementTarget | None = None, secret: bool = False,
                        delivery: Delivery = "background") -> ActionResult: ...
    async def key(self, combo: str, *, repeat: int = 1, hold_ms: int = 0) -> ActionResult: ...  # "Ctrl+Shift+T", canonical names
    async def mouse_down(self, button: Button = "left") -> ActionResult: ...
    async def mouse_up(self, button: Button = "left") -> ActionResult: ...

    # verification & misc
    async def verify(self, target: WindowRef | Literal["page","desktop"], predicates: Sequence[Predicate], *,
                     timeout_ms: int = 3000, stable_samples: int = 2) -> VerifyResult: ...
    async def wait_idle(self, timeout_ms: int = 3000) -> None: ...        # network idle / a11y events quiet / pixel stable
    async def clipboard_get(self) -> str: ...
    async def clipboard_set(self, text: str) -> None: ...

    # recording
    async def start_recording(self, out_dir: str, *, video: bool = False) -> None: ...
    async def stop_recording(self) -> str: ...
```

### Rules the interface enforces
1. `observe()` returns a snapshot. Only tokens from the **latest** snapshot of that target are valid. A stale token returns `effect="refused", error_code="stale_token"`, and the backend never re-resolves it silently.
2. Pixel actions take a `PointTarget` that carries the `capture_id` of the capture the grounder looked at. The backend owns all scaling: model frame → capture px → logical → device.
3. `click(ElementTarget)` routes semantic first (invoke/do_action/AXPress/Playwright locator). It uses the pointer only when the element has trusted bounds and the backend allows it. `result.route` reports the path taken.
4. Each action returns an `ActionResult` with an honest `effect`. `confirmed` requires readback or state evidence. The runner then reobserves: one action per observation.
5. The chooser sees `stable_id` plus a description plus the `reobserve`/`abstain` candidates. It never sees tokens or coordinates. Tables over 255 entries get relevance-capped. Risk-tagged candidates are removed unless the task allows them.
6. `secret=True` values are never logged. Values are never used in IDs or descriptions.
7. Backends: `PlaywrightComputer` (CDP/aria snapshot), `AtspiX11Computer`, `GnomeWaylandComputer`, `UiaComputer`, `AxComputer`. Capability flags expose the differences instead of hiding them.

### Playwright mapping
- `observe` builds elements from `page.accessibility`/`ariaSnapshot()` or a DOM walk.
- `role` is the ARIA role directly and `name` is the accessible name.
- `bounds` in css_px come from `boundingBox()`, and `capture.scale = devicePixelRatio`.
- `automation_id` is `data-testid`.
- `token` maps to an internal Locator (`aria-ref` or a stored handle).
- `press` is `locator.click()`, whose actionability checks are the evidence. `set_value` is `fill()`.
- `verify` uses `expect`-style polling.

### Native role map (starting table, extend beyond RFC 4268)

| ARIA role | AT-SPI | UIA ControlType | AX |
|---|---|---|---|
| button | push button, button | Button, SplitButton | AXButton |
| checkbox | check box | CheckBox | AXCheckBox |
| switch | toggle button | Button+TogglePattern | AXSwitch (subrole) |
| radio | radio button | RadioButton | AXRadioButton |
| combobox | combo box | ComboBox | AXPopUpButton, AXComboBox |
| menuitem | menu item | MenuItem | AXMenuItem, AXMenuBarItem |
| menuitemcheckbox | check menu item | MenuItem+Toggle | AXMenuItem (checked attr) |
| link | link | Hyperlink | AXLink |
| textbox | entry, text (editable), password text | Edit, Document | AXTextField, AXTextArea, AXSearchField, AXSecureTextField |
| tab | page tab | TabItem | AXRadioButton subrole AXTabButton |
| slider | slider | Slider | AXSlider |
| spinbutton | spin button | Spinner | AXIncrementor |
| listitem / option | list item | ListItem | AXRow / AXStaticText in AXList |
| treeitem | tree item | TreeItem | AXRow (outline) |
| cell | table cell | DataItem | AXCell |
| StaticText | label, static | Text | AXStaticText |

Pitfall: AT-SPI `text` is editable only if the EditableText interface or the `editable` state is present. Decide by interface or state, not by the role string.

---

## 11. Linux first backend: container X11 vs GNOME Mutter D-Bus

### Recommendation
Build the **X11 container backend first**, as the CI/test target. Build GNOME Wayland second, for the host.

The X11 container:
- Xvfb (or TigerVNC) + a lightweight WM (xfwm4/mutter --x11) + at-spi2 enabled.
- Screenshots via XShm/`XGetImage` (python-xlib/mss).
- Input via XTest (python-xlib `xtest.fake_input`; xdotool acceptable).
- Semantics via AT-SPI (pyatspi/gi `Atspi` or zbus-equivalent).
- Screen-coordinate extents from AT-SPI are correct on X11, so bounds_trust="exact". This lets us test vision fallback and semantic paths against the same ground truth.

Reasons:
- Deterministic.
- No consent dialogs.
- Trusted coordinates.
- Parallelizable.
- Matches the reference images: the Anthropic demo and the cua xfce image.
- The same code path works for Xwayland-free CI.

Container recipe notes:
- `Xvfb :1 -screen 0 1280x800x24 -dpi 96 -nolisten tcp` (Anthropic uses `-ac ... -nolisten unix` too).
- `xset s off -dpms`.
- `dbus-run-session` so the a11y bus exists.
- Export `GTK_MODULES=gail:atk-bridge` (GTK3), `NO_AT_BRIDGE=0`, `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`, `ACCESSIBILITY_ENABLED=1`.
- `gsettings set org.gnome.desktop.interface toolkit-accessibility true`.
- Chromium/Electron need `--force-renderer-accessibility`.
- Firefox needs `GNOME_ACCESSIBILITY=1`.
- x11vnc/noVNC for watching, bound to 127.0.0.1.
- Record with `ffmpeg -f x11grab`.
- Set a fixed DPI to avoid HiDPI surprises. Add a `--scale` variant later to test HiDPI.

### GNOME 50 Wayland on the host: pitfalls to design for
1. **Consent.**
   - Portal RemoteDesktop prompts every new process unless `persist_mode=2` and a restore token are used. The token goes on `SelectDevices`, never on ScreenCast `SelectSources`. Tokens are single-use: store the new one after each `Start`.
   - Direct `org.gnome.Mutter.RemoteDesktop` (ponytail/dogtail-hermetic style) needs no prompt but is a private API; it works from the user session bus today.
   - Choose portal+libei for the host and direct Mutter only inside a headless `mutter --headless --virtual-monitor` test session.
2. **Coordinates.**
   - AT-SPI `CoordType::Screen` is (0,0)-relative per window on Mutter, so do not trust element bounds. Set `bounds_trust="untrusted"` and act semantically: `do_action` / `EditableText.set_text_contents` / `grab_focus`.
   - Portal absolute motion needs a stream `node_id`. In GNOME 50 logical layout mode, multiply by the monitor scale (`monitor.x + stream_x / scale`). Re-check `DisplayConfig.GetCurrentState` when monitors change.
   - Window-relative clicks: RecordWindow streams (ponytail) make `NotifyPointerMotionAbsolute` window-relative. Window geometry otherwise needs a Shell extension, because Introspect is gated behind unsafe_mode on GNOME 41+.
   - GTK4 shadows (default offset 12,12) break window-relative math (dogtail).
3. **Screenshots.**
   - `org.gnome.Shell.Screenshot` rejects unknown senders (DBusSenderChecker).
   - Portal Screenshot cancels (response 2) without a foreground window.
   - The robust path is a ScreenCast (portal or Mutter) PipeWire stream, which also gives video. Otherwise fall back to the portal screenshot `interactive=false`.
4. **Input quirks.**
   - Keysyms missing from the current layout are dropped, so send letters and digits as keycodes (XKB = evdev+8).
   - Always release every press (use guards).
   - Mutter 50.2/50.3 drop the first 3 pointer events, so warm up.
   - Clicks may miss unfocused windows: activate first.
   - Serialize all input.
5. **Accessibility off.** `toolkit-accessibility` is currently `false` on this host. Apps must be restarted after enabling it. Electron needs flags. Libadwaita/GTK4 nests a same-name `label` inside `button`, so match by role.
6. **Permissions.** `/dev/uinput` is root-only here, so the ydotool/uinput fallback needs a udev rule. Avoid it; prefer libei via portal `ConnectToEIS`, which is available (libei 1.6).
7. **Headless GNOME test session.**
   - `dbus-run-session mutter --headless --virtual-monitor 1280x800 --wayland` (or `gnome-shell --headless`) plus direct Mutter RemoteDesktop/ScreenCast gives a prompt-free, isolated Wayland target that still exercises the GNOME code paths.
   - Validate on 50.4 before depending on it; dogtail HERMETIC.md is the recipe.

The doctor must check:
- `XDG_SESSION_TYPE`
- `org.a11y.Status.IsEnabled` / `toolkit-accessibility`
- portal RemoteDesktop/ScreenCast versions (≥2 for persistence)
- Mutter bus names
- libei availability
- restore token presence
- layout-mode and scales
- `/dev/uinput` access

It reports blockers and a next step, following `computer-use-linux/src/diagnostics.rs`.
