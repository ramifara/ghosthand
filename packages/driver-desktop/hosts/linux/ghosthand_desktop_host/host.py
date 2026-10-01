# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""RPC methods over AT-SPI plus a pointer/keyboard/capture backend (X11 XTest or Mutter RemoteDesktop).

Rules (plan §3.2, desktop note §10):
- Only refs of the latest snapshot are accepted; a stale ref is refused and never re-resolved.
- Semantic routes first (Action, EditableText, Value, Selection); synthetic input only as a fallback and only
  where element bounds are trusted.
- Every act returns before/after read-backs so the client can judge the effect. Values typed into fields are
  never logged.
"""

import base64
import os
import shutil
import subprocess
import time

from . import HOST_VERSION, PROTOCOL_VERSION
from . import atspi_tree as tree
from .atspi_tree import Atspi
from .rpc import RpcError, log

PRESS_ACTIONS = ("click", "press", "activate", "jump", "open", "toggle", "select")
TOGGLE_ACTIONS = ("toggle", "click", "press", "activate")
ITEM_ROLES = {"list item", "table cell", "tree item", "menu item", "check menu item", "radio menu item", "page tab"}
CHROMIUM_LIKE = ("chrome", "chromium", "electron", "code", "brave", "msedge")
EVENT_TYPES = (
    "object:children-changed",
    "object:state-changed",
    "object:property-change:accessible-name",
    "object:text-changed",
    "object:selection-changed",
    "window:",
)


def _now_ms():
    return int(time.time() * 1000)


def _descendants(pids):
    """`pids` plus every descendant process (Chromium and some launchers fork)."""
    found = set(pids)
    try:
        entries = [e for e in os.listdir("/proc") if e.isdigit()]
    except OSError:
        return found
    parent = {}
    for e in entries:
        try:
            with open(f"/proc/{e}/stat", encoding="utf-8", errors="replace") as f:
                stat = f.read()
            ppid = int(stat[stat.rfind(")") + 2 :].split()[1])
            parent[int(e)] = ppid
        except (OSError, ValueError, IndexError):
            continue
    changed = True
    while changed:
        changed = False
        for pid, ppid in parent.items():
            if ppid in found and pid not in found:
                found.add(pid)
                changed = True
    return found


class Host:
    def __init__(self, platform, input_backend, capture, screen, bounds_trust, sandbox=None, extra_doctor=None):
        self.platform = platform
        self.input = input_backend
        self.capture = capture
        self.screen = screen  # {"width", "height", "scale"}
        self.bounds_trust = bounds_trust
        self.sandbox = sandbox
        self.extra_doctor = extra_doctor
        self.procs = []
        self.seq = 0
        self.latest_id = None
        self.latest = []
        self.events = 0
        self._listener = None
        self._register_events()

    # ---- events ---------------------------------------------------------------------------------

    def _register_events(self):
        try:
            def on_event(_event):
                self.events += 1

            self._listener = Atspi.EventListener.new(on_event)
            for t in EVENT_TYPES:
                self._listener.register(t)
        except Exception as e:  # noqa: BLE001 - idle detection degrades to tree polling
            log("AT-SPI event listener unavailable:", type(e).__name__)
            self._listener = None

    def _quiet(self, cap_ms, quiet_ms):
        start = time.monotonic()
        last = self.events
        last_change = start
        while True:
            tree.pump()
            now = time.monotonic()
            if self.events != last:
                last = self.events
                last_change = now
            if (now - last_change) * 1000 >= quiet_ms:
                return int((now - start) * 1000), "quiet"
            if (now - start) * 1000 >= cap_ms:
                return int((now - start) * 1000), "cap"
            time.sleep(0.02)

    # ---- scope ----------------------------------------------------------------------------------

    def _apps(self, scope="app"):
        apps = tree.list_apps()
        if scope == "desktop" or not self.procs:
            return [a for a in apps if tree.top_windows(a)]
        pids = _descendants([p.pid for p in self.procs if p.poll() is None] or [p.pid for p in self.procs])
        mine = [a for a in apps if tree.app_pid(a) in pids]
        return mine if mine else [a for a in apps if tree.top_windows(a)]

    def _global(self, apps=None):
        apps = apps if apps is not None else self._apps()
        titles, active = tree.window_summary(apps)
        out = {"windows": titles, "events": self.events, "contentHash": tree.content_hash(apps)}
        if active is not None:
            out["activeWindow"] = active
        focused = tree.focused_summary(apps)
        if focused is not None:
            role = tree._safe(focused.get_role_name, "") or ""
            name = tree._safe(focused.get_name, "") or ""
            out["focused"] = f"{role}:{name}"[:200]
        return out

    # ---- methods --------------------------------------------------------------------------------

    def hello(self, params):
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "host": {"name": "ghosthand-desktop-host-linux", "version": HOST_VERSION},
            "platform": self.platform,
            "capabilities": {
                "semanticActions": True,
                "pointer": self.input is not None and self.input.available(),
                "screenshots": self.capture is not None and self.capture.method is not None,
                "recording": shutil.which("ffmpeg") is not None and self.platform == "linux-x11",
                "boundsTrust": self.bounds_trust,
                **({"vncUrl": self.sandbox.vnc_url} if self.sandbox is not None and self.sandbox.vnc_url else {}),
            },
            "screen": self.screen,
        }

    def doctor(self, params):
        checks = []
        display = os.environ.get("DISPLAY")
        if self.platform == "linux-x11":
            checks.append({"name": "x11 display", "ok": bool(display), "detail": display or "DISPLAY not set"})
            if self.sandbox is not None:
                checks.append({"name": "window manager", "ok": True, "detail": self.sandbox.wm or "none (optional)"})
        try:
            n = len(tree.list_apps())
            checks.append({"name": "at-spi bus", "ok": True, "detail": f"{n} accessible application(s)"})
        except Exception as e:  # noqa: BLE001
            checks.append({"name": "at-spi bus", "ok": False, "detail": f"{type(e).__name__}: {e}"[:200]})
        checks.append(
            {
                "name": "input",
                "ok": self.input is not None and self.input.available(),
                "detail": getattr(self.input, "route", "none") if self.input is not None else "none",
            }
        )
        checks.append(
            {
                "name": "screenshots",
                "ok": self.capture is not None and self.capture.method is not None,
                "detail": (self.capture.method if self.capture is not None else None) or "none",
            }
        )
        checks.append(
            {"name": "ffmpeg", "ok": shutil.which("ffmpeg") is not None, "detail": shutil.which("ffmpeg") or "missing (recording off)"}
        )
        if self.extra_doctor is not None:
            checks.extend(self.extra_doctor())
        return {"checks": checks}

    def launch(self, params):
        argv = params.get("argv") or []
        if not argv:
            raise RpcError("launch_failed", "argv is empty")
        exe = shutil.which(argv[0]) or argv[0]
        argv = [exe, *argv[1:]]
        env = dict(os.environ)
        env.update(
            {
                "GTK_MODULES": "gail:atk-bridge",
                "NO_AT_BRIDGE": "0",
                "QT_LINUX_ACCESSIBILITY_ALWAYS_ON": "1",
                "QT_ACCESSIBILITY": "1",
                "ACCESSIBILITY_ENABLED": "1",
                "GNOME_ACCESSIBILITY": "1",
            }
        )
        for k, v in (params.get("env") or {}).items():
            env[str(k)] = str(v)
        base = os.path.basename(exe).lower()
        if any(c in base for c in CHROMIUM_LIKE):
            extra = ["--force-renderer-accessibility", "--no-first-run", "--no-default-browser-check"]
            if os.environ.get("GHOSTHAND_IN_CONTAINER") == "1":
                # The container is the sandbox; Chromium's own sandbox needs user namespaces it doesn't have.
                extra += ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
            argv = [argv[0], *extra, *argv[1:]]
        try:
            p = subprocess.Popen(
                argv,
                env=env,
                cwd=params.get("cwd") or None,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError as e:
            raise RpcError("launch_failed", f"cannot start {os.path.basename(exe)}: {e.strerror}") from e
        self.procs.append(p)
        wait_ms = int(params.get("waitMs", 15000))
        deadline = time.monotonic() + wait_ms / 1000
        title = None
        while time.monotonic() < deadline:
            tree.pump()
            if p.poll() is not None and not _descendants([p.pid]) - {p.pid}:
                raise RpcError("launch_failed", f"{os.path.basename(exe)} exited with code {p.returncode}")
            pids = _descendants([p.pid])
            for app in tree.list_apps():
                if tree.app_pid(app) not in pids:
                    continue
                titles, active = tree.window_summary([app])
                if titles:
                    title = active or titles[0].split(":", 1)[-1]
                    break
            if title is not None:
                break
            time.sleep(0.1)
        if title is None:
            raise RpcError("launch_failed", f"no accessible window from {os.path.basename(exe)} within {wait_ms} ms")
        self._quiet(2000, 300)
        return {"pid": p.pid, "windowTitle": title}

    def observe(self, params):
        tree.pump()
        t0 = time.monotonic()
        apps = self._apps(params.get("scope", "app"))
        walk = tree.Walk(
            max_nodes=int(params.get("maxNodes", 2000)),
            max_depth=int(params.get("maxDepth", 40)),
            timeout_s=int(params.get("timeoutMs", 4000)) / 1000,
        ).run(apps)
        self.seq += 1
        sid = f"h{self.seq}"
        if not params.get("transient"):
            self.latest_id = sid
            self.latest = walk.accs
        out = {
            "snapshotId": sid,
            "takenAt": _now_ms(),
            "screen": {"x": 0, "y": 0, "width": self.screen["width"], "height": self.screen["height"]},
            "scale": self.screen.get("scale", 1),
            "title": walk.active_title or "",
            "nodes": walk.nodes,
            "complete": walk.complete,
            "walkMs": int((time.monotonic() - t0) * 1000),
        }
        if walk.app_name:
            out["appName"] = walk.app_name
        if walk.degraded:
            out["degradedReason"] = walk.degraded
        return out

    def _resolve(self, params):
        sid = params.get("snapshotId")
        ref = params.get("ref")
        if sid != self.latest_id:
            raise RpcError("stale_token", f"snapshot {sid} is not the latest ({self.latest_id}); observe again")
        if not isinstance(ref, int) or ref < 0 or ref >= len(self.latest):
            raise RpcError("stale_token", f"ref {ref} is not in snapshot {sid}")
        acc = self.latest[ref]
        if tree.probe(acc) is None:
            raise RpcError("stale_token", f"the element of ref {ref} is gone; observe again")
        return acc

    def _invalidate(self):
        self.latest_id = None
        self.latest = []

    def _center(self, acc):
        if self.bounds_trust != "exact":
            return None
        b = tree.extents(acc)
        if b is None:
            return None
        return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

    def act(self, params):
        op = params.get("op")
        acc = self._resolve(params)
        role = tree._safe(acc.get_role_name, "") or ""
        g0 = self._global()
        before = tree.probe(acc)
        self._invalidate()
        try:
            route, native = self._dispatch(op, acc, role, params, before)
            error = None
        except RpcError as e:
            if e.kind in ("not_interactable", "unsupported", "not_found"):
                return {"ok": False, "route": "none", "nativeRoute": "", "before": before, "after": before,
                        "globalBefore": g0, "globalAfter": g0, "error": {"kind": e.kind, "message": e.message}}
            route, native, error = "semantic", "", {"kind": e.kind, "message": e.message}
        quick = op in ("set_value", "toggle", "focus", "scroll_into_view", "select_text", "select_option")
        self._quiet(600 if quick else 1500, 120 if quick else 250)
        after = tree.probe(acc)
        out = {
            "ok": error is None,
            "route": route,
            "nativeRoute": native,
            "before": before,
            "after": after,
            "globalBefore": g0,
            "globalAfter": self._global(),
        }
        if error is not None:
            out["error"] = error
        return out

    def _do_named(self, acc, preferred):
        names = tree.action_names(acc)
        for want in preferred:
            for i, n in enumerate(names):
                if n.lower() == want:
                    if not Atspi.Action.do_action(acc, i):
                        raise RpcError("driver", f"action {n} returned false")
                    return f"atspi.do_action({n})"
        if names:
            if not Atspi.Action.do_action(acc, 0):
                raise RpcError("driver", f"action {names[0]} returned false")
            return f"atspi.do_action({names[0]})"
        return None

    def _select_in_parent(self, acc):
        parent = tree._safe(acc.get_parent)
        if parent is None or "Selection" not in tree.interfaces(parent):
            return None
        idx = tree._safe(acc.get_index_in_parent, -1)
        if idx is None or idx < 0:
            return None
        if not Atspi.Selection.select_child(parent, idx):
            raise RpcError("driver", "selection refused")
        return "atspi.selection.select_child"

    def _pointer_click(self, acc):
        c = self._center(acc)
        if c is None or self.input is None or not self.input.available():
            return None
        self.input.click(c[0], c[1])
        return f"{self.input.route}.click"

    def _dispatch(self, op, acc, role, params, before):
        if op == "press":
            native = self._do_named(acc, PRESS_ACTIONS) if "Action" in tree.interfaces(acc) else None
            if native is None and role in ITEM_ROLES:
                native = self._select_in_parent(acc)
            if native is not None:
                return "semantic", native
            native = self._pointer_click(acc)
            if native is not None:
                return "pointer", native
            raise RpcError("not_interactable", f"{role} has no action, selection or trusted bounds")
        if op == "set_value":
            return self._set_value(acc, role, str(params.get("value", "")), before)
        if op == "toggle":
            want = params.get("checked")
            states = before["states"] if before else []
            is_on = "checked" in states or "pressed" in states
            if want is not None and bool(want) == is_on:
                return "semantic", "noop.already_in_state"
            native = self._do_named(acc, TOGGLE_ACTIONS) if "Action" in tree.interfaces(acc) else None
            if native is not None:
                return "semantic", native
            native = self._pointer_click(acc)
            if native is not None:
                return "pointer", native
            raise RpcError("not_interactable", f"{role} cannot be toggled")
        if op == "select_option":
            return self._select_option(acc, role, str(params.get("option", "")))
        if op == "focus":
            if not tree._safe(lambda: Atspi.Component.grab_focus(acc), False):
                native = self._pointer_click(acc)
                if native is None:
                    raise RpcError("not_interactable", "grab_focus refused")
                return "pointer", native
            return "semantic", "atspi.component.grab_focus"
        if op == "scroll_into_view":
            ok = tree._safe(lambda: Atspi.Component.scroll_to(acc, Atspi.ScrollType.ANYWHERE), False)
            return "semantic", "atspi.component.scroll_to" if ok else "noop.scroll_to_unsupported"
        if op == "select_text":
            text = str(params.get("text", ""))
            if "Text" not in tree.interfaces(acc):
                raise RpcError("not_interactable", f"{role} has no text")
            full = tree.text_of(acc, tree.interfaces(acc)) or ""
            i = full.find(text)
            if i < 0:
                i = full.lower().find(text.lower())
            if i < 0:
                raise RpcError("not_found", "text not found in the element")
            tree._safe(lambda: Atspi.Component.grab_focus(acc))
            ok = tree._safe(lambda: Atspi.Text.set_selection(acc, 0, i, i + len(text)), False) or tree._safe(
                lambda: Atspi.Text.add_selection(acc, i, i + len(text)), False
            )
            if not ok:
                raise RpcError("driver", "text selection refused")
            return "semantic", "atspi.text.set_selection"
        raise RpcError("unsupported", f"unknown op {op}")

    def _set_value(self, acc, role, value, before):
        ifaces = tree.interfaces(acc)
        if "EditableText" in ifaces:
            if tree._safe(lambda: Atspi.EditableText.set_text_contents(acc, value), False):
                tree.pump()
                after = tree.probe(acc)
                if after is not None and (after.get("value") == value or after.get("valueLength") == len(value)):
                    return "semantic", "atspi.editable_text.set_text_contents"
            # Idempotent keyboard fallback: focus, select all, type. Only when the semantic route changed nothing.
            if self.input is not None and self.input.available():
                cur = tree.probe(acc)
                unchanged = cur is not None and before is not None and cur.get("value") == before.get("value")
                if unchanged:
                    tree._safe(lambda: Atspi.Component.grab_focus(acc))
                    self.input.key(["Control", "a"])
                    self.input.type_text(value)
                    return "keyboard", f"{self.input.route}.type"
            return "semantic", "atspi.editable_text.set_text_contents"
        if "Value" in ifaces:
            try:
                num = float(value)
            except ValueError as e:
                raise RpcError("not_interactable", f"{role} takes a number") from e
            if not tree._safe(lambda: Atspi.Value.set_current_value(acc, num), False):
                raise RpcError("driver", "set_current_value refused")
            return "semantic", "atspi.value.set_current_value"
        if role == "combo box":
            return self._select_option(acc, role, value)
        raise RpcError("not_interactable", f"{role} is not editable")

    def _select_option(self, acc, role, option):
        want = option.strip().lower()
        candidates = []
        stack = [(acc, 0)]
        while stack:
            node, depth = stack.pop(0)
            for i in range(tree._safe(node.get_child_count, 0) or 0):
                child = tree._safe(lambda i=i, node=node: node.get_child_at_index(i))
                if child is None:
                    continue
                crole = tree._safe(child.get_role_name, "") or ""
                if crole in ITEM_ROLES:
                    candidates.append((child, node, i, (tree._safe(child.get_name, "") or "").strip()))
                elif depth < 2:
                    stack.append((child, depth + 1))
        exact = [c for c in candidates if c[3].lower() == want]
        fuzzy = [c for c in candidates if want and want in c[3].lower()]
        pick = exact[0] if exact else (fuzzy[0] if len(fuzzy) == 1 else None)
        if pick is None:
            raise RpcError("not_found", f"no single option matches ({len(candidates)} options)")
        item, container, index, _ = pick
        # The element's own Selection first (GTK combo: sets the active item); its option index is the item's
        # index in the (hidden) menu, which equals the active index.
        if container is not acc and "Selection" in tree.interfaces(acc):
            if tree._safe(lambda: Atspi.Selection.select_child(acc, index), False):
                return "semantic", "atspi.selection.select_child(element)"
        if "Selection" in tree.interfaces(container):
            if tree._safe(lambda: Atspi.Selection.select_child(container, index), False):
                return "semantic", "atspi.selection.select_child"
        native = self._do_named(item, ("click", "activate", "press", "select")) if "Action" in tree.interfaces(item) else None
        if native is None:
            raise RpcError("not_interactable", "the option has no action")
        return "semantic", native

    def input_op(self, params):
        if self.input is None or not self.input.available():
            raise RpcError("unsupported", "synthetic input is unavailable on this host")
        op = params.get("op")
        if op in ("type", "key") and hasattr(self.input, "ensure_focus") and self.procs:
            self.input.ensure_focus(sorted(_descendants([p.pid for p in self.procs if p.poll() is None])))
        g0 = self._global()
        f0 = self._focused_value()
        self._invalidate()
        if op == "click":
            self.input.click(params["x"], params["y"], params.get("button", "left"), int(params.get("count", 1)))
        elif op == "move":
            self.input.move(params["x"], params["y"])
        elif op == "drag":
            self.input.drag(params["x"], params["y"], params["toX"], params["toY"])
        elif op == "scroll":
            self.input.scroll(params.get("dx", 0), params.get("dy", 0), params.get("x"), params.get("y"))
        elif op == "type":
            self.input.type_text(str(params.get("text", "")))
        elif op == "key":
            self.input.key([str(k) for k in params.get("keys", [])])
        else:
            raise RpcError("unsupported", f"unknown input op {op}")
        self._quiet(1500, 200)
        out = {
            "ok": True,
            "route": "keyboard" if op in ("type", "key") else "pointer",
            "nativeRoute": f"{self.input.route}.{op}",
            "globalBefore": g0,
            "globalAfter": self._global(),
        }
        f1 = self._focused_value()
        if f0 is not None:
            out["focusedBefore"] = f0
        if f1 is not None:
            out["focusedAfter"] = f1
        return out

    def _focused_value(self):
        acc = tree.focused_summary(self._apps())
        if acc is None:
            return None
        p = tree.probe(acc)
        if p is None:
            return None
        role = tree._safe(acc.get_role_name, "") or ""
        out = {"role": role, "name": p.get("name", "")}
        if "value" in p:
            out["value"] = p["value"]
        if "valueLength" in p:
            out["valueLength"] = p["valueLength"]
        return out

    def screenshot(self, params):
        if self.capture is None or self.capture.method is None:
            raise RpcError("unsupported", "screenshots are unavailable on this host")
        data = self.capture.screenshot(params.get("region"))
        from .x11_capture import png_size  # noqa: PLC0415

        w, h = png_size(data)
        return {
            "data": base64.b64encode(data).decode("ascii"),
            "mimeType": "image/png",
            "width": w,
            "height": h,
            "scale": self.screen.get("scale", 1),
        }

    def wait_idle(self, params):
        waited, reason = self._quiet(int(params.get("capMs", 3000)), int(params.get("quietMs", 250)))
        return {"waitedMs": waited, "reason": reason}

    def record_start(self, params):
        if self.capture is None or not hasattr(self.capture, "start_recording"):
            raise RpcError("unsupported", "recording is unavailable on this host")
        self.capture.start_recording(str(params["path"]))
        return {}

    def record_stop(self, params):
        if self.capture is None or not hasattr(self.capture, "stop_recording"):
            raise RpcError("unsupported", "recording is unavailable on this host")
        return {"files": self.capture.stop_recording()}

    def close(self, params=None):
        if self.capture is not None and getattr(self.capture, "recording", None) is not None:
            try:
                self.capture.stop_recording()
            except RpcError:
                pass
        for p in self.procs:
            if p.poll() is None:
                try:
                    os.killpg(p.pid, 15)
                except (ProcessLookupError, PermissionError):
                    pass
        for p in self.procs:
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, 9)
                except (ProcessLookupError, PermissionError):
                    pass
        self.procs = []
        return {}

    def handlers(self):
        return {
            "hello": self.hello,
            "doctor": self.doctor,
            "launch": self.launch,
            "observe": self.observe,
            "act": self.act,
            "input": self.input_op,
            "screenshot": self.screenshot,
            "wait_idle": self.wait_idle,
            "record_start": self.record_start,
            "record_stop": self.record_stop,
            "close": self.close,
        }
