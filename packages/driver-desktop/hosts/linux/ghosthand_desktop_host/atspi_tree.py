# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""AT-SPI observation through GObject introspection (libatspi). Native facts only; the TypeScript client maps
roles, ranks, redacts and builds the element table.
"""

import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, GLib  # noqa: E402

Atspi.init()

# Containers whose subtree is skipped when they are not showing. Combo boxes keep their (hidden) option menus.
_SKIP_ROLES = {"scroll bar", "separator", "tool tip", "redundant object"}
_TOP_ROLES = {"frame", "window", "dialog", "alert", "file chooser", "color chooser", "font chooser"}
MAX_OPTIONS = 1024


def pump(max_iterations=200):
    """Dispatches pending D-Bus/AT-SPI events on the default main context."""
    ctx = GLib.MainContext.default()
    n = 0
    while n < max_iterations and ctx.pending():
        ctx.iteration(False)
        n += 1


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:  # noqa: BLE001 - AT-SPI raises GLib.Error for defunct objects; treat as absent
        return default


def state_names(acc):
    ss = _safe(acc.get_state_set)
    if ss is None:
        return []
    out = []
    for st in _safe(ss.get_states, []) or []:
        nick = _safe(lambda st=st: st.value_nick)
        if nick:
            out.append(nick.replace("_", "-"))
    return out


def interfaces(acc):
    return list(_safe(acc.get_interfaces, []) or [])


def action_names(acc):
    n = _safe(lambda: Atspi.Action.get_n_actions(acc), 0) or 0
    return [(_safe(lambda i=i: Atspi.Action.get_action_name(acc, i), "") or "") for i in range(min(n, 16))]


def extents(acc):
    r = _safe(lambda: Atspi.Component.get_extents(acc, Atspi.CoordType.SCREEN))
    if r is None or r.width <= 0 or r.height <= 0:
        return None
    return {"x": r.x, "y": r.y, "width": r.width, "height": r.height}


def text_of(acc, ifaces):
    if "Text" not in ifaces:
        return None
    n = _safe(lambda: Atspi.Text.get_character_count(acc), 0) or 0
    if n <= 0:
        return ""
    return _safe(lambda: Atspi.Text.get_text(acc, 0, min(n, 4000)), "")


def value_range(acc, ifaces):
    if "Value" not in ifaces:
        return None, None
    cur = _safe(lambda: Atspi.Value.get_current_value(acc))
    lo = _safe(lambda: Atspi.Value.get_minimum_value(acc))
    hi = _safe(lambda: Atspi.Value.get_maximum_value(acc))
    step = _safe(lambda: Atspi.Value.get_minimum_increment(acc))
    rng = None
    if lo is not None and hi is not None:
        rng = {"min": lo, "max": hi}
        if step:
            rng["step"] = step
    return cur, rng


def is_secret(role):
    return role == "password text"


def selected_via_selection(acc):
    """Name of the selected child through the element's own Selection interface (the combo's active item)."""
    if "Selection" not in interfaces(acc):
        return None
    if (_safe(lambda: Atspi.Selection.get_n_selected_children(acc), 0) or 0) <= 0:
        return None
    child = _safe(lambda: Atspi.Selection.get_selected_child(acc, 0))
    return (_safe(child.get_name, "") or None) if child is not None else None


def combo_options(acc):
    """Option labels and the selected one for a combo box (GTK3 keeps a hidden menu child).

    The selected option comes from the combo's own Selection interface: the hidden menu's selection is not the
    combo's active item.
    """
    options = []
    selected = selected_via_selection(acc)
    own_selection = selected is not None or "Selection" in interfaces(acc)
    stack = [(acc, 0)]
    while stack and len(options) < MAX_OPTIONS:
        node, depth = stack.pop(0)
        for i in range(_safe(node.get_child_count, 0) or 0):
            child = _safe(lambda i=i, node=node: node.get_child_at_index(i))
            if child is None:
                continue
            role = _safe(child.get_role_name, "")
            if role in ("menu item", "list item", "check menu item", "radio menu item", "table cell"):
                name = _safe(child.get_name, "") or ""
                if name:
                    options.append(name)
                    if not own_selection and ("selected" in state_names(child) or "checked" in state_names(child)):
                        selected = name
            elif depth < 2:
                stack.append((child, depth + 1))
    return options, selected


def app_pid(app):
    return _safe(app.get_process_id, -1)


def list_apps():
    desktop = Atspi.get_desktop(0)
    apps = []
    for i in range(_safe(desktop.get_child_count, 0) or 0):
        app = _safe(lambda i=i: desktop.get_child_at_index(i))
        if app is not None:
            apps.append(app)
    return apps


def top_windows(app):
    out = []
    for i in range(_safe(app.get_child_count, 0) or 0):
        w = _safe(lambda i=i: app.get_child_at_index(i))
        if w is None:
            continue
        out.append(w)
    return out


def window_summary(apps):
    """Titles of showing top-level windows, the active one and the focused element (for evidence)."""
    titles = []
    active = None
    for app in apps:
        for w in top_windows(app):
            states = state_names(w)
            if "showing" not in states and "visible" not in states:
                continue
            title = _safe(w.get_name, "") or ""
            role = _safe(w.get_role_name, "") or ""
            titles.append(f"{role}:{title}")
            if "active" in states:
                active = title
    return titles, active


class Walk:
    """One observation: nodes (JSON-ready) plus the live accessibles by ref, for acting on tokens."""

    def __init__(self, max_nodes=2000, max_depth=40, timeout_s=4.0):
        self.max_nodes = max_nodes
        self.max_depth = max_depth
        self.deadline = time.monotonic() + timeout_s
        self.nodes = []
        self.accs = []
        self.texts = []
        self.complete = True
        self.degraded = None
        self.active_title = None
        self.app_name = None

    def run(self, apps):
        for app in apps:
            if self.app_name is None:
                self.app_name = _safe(app.get_name, None)
            for w in top_windows(app):
                states = state_names(w)
                if "showing" not in states and "visible" not in states:
                    continue
                if "active" in states and self.active_title is None:
                    self.active_title = _safe(w.get_name, "") or ""
                self._visit(w, None, 0, None)
        return self

    def _visit(self, acc, parent_ref, depth, window_ref):
        if len(self.nodes) >= self.max_nodes:
            self.complete = False
            self.degraded = f"node cap {self.max_nodes} reached"
            return
        if time.monotonic() > self.deadline:
            self.complete = False
            self.degraded = "observation timed out"
            return
        role = _safe(acc.get_role_name, "") or ""
        if role in _SKIP_ROLES:
            return
        states = state_names(acc)
        if "defunct" in states:
            return
        showing = "showing" in states
        if not showing and depth > 0:
            return
        ifaces = interfaces(acc)
        ref = len(self.nodes)
        if role in _TOP_ROLES and window_ref is None:
            window_ref = ref
        node = {
            "ref": ref,
            "parent": parent_ref,
            "depth": depth,
            "role": role,
            "name": _safe(acc.get_name, "") or "",
            "states": states,
            "interfaces": ifaces,
            "actions": action_names(acc) if "Action" in ifaces else [],
            "bounds": extents(acc) if "Component" in ifaces else None,
            "window": window_ref if window_ref is not None else ref,
            "childCount": _safe(acc.get_child_count, 0) or 0,
        }
        desc = _safe(acc.get_description, "") or ""
        if desc:
            node["description"] = desc
        aid = _safe(acc.get_accessible_id, "") or ""
        if aid:
            node["automationId"] = aid
        secret = is_secret(role)
        node["secret"] = secret
        txt = text_of(acc, ifaces)
        if txt is not None:
            if secret:
                node["valueLength"] = len(txt)
            elif "EditableText" in ifaces or "editable" in states:
                node["value"] = txt
            elif txt and txt != node["name"]:
                node["text"] = txt[:500]
        cur, rng = value_range(acc, ifaces)
        if cur is not None and "value" not in node and not secret:
            node["value"] = _fmt_number(cur)
        if rng is not None:
            node["range"] = rng
        if role == "combo box":
            options, selected = combo_options(acc)
            if options:
                node["options"] = options[:MAX_OPTIONS]
                node["optionCount"] = len(options)
            if selected is not None:
                node["selectedOption"] = selected
        self.nodes.append(node)
        self.accs.append(acc)
        if role == "combo box":
            # Options are reported on the combo itself; the hidden menu is not walked.
            return
        if depth >= self.max_depth:
            return
        for i in range(min(node["childCount"], 2000)):
            child = _safe(lambda i=i: acc.get_child_at_index(i))
            if child is None:
                continue
            self._visit(child, ref, depth + 1, window_ref)


def _fmt_number(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def probe(acc):
    """Read-back of one element for effect evidence; None when the element is gone."""
    _safe(acc.clear_cache)
    role = _safe(acc.get_role_name)
    if role is None:
        return None
    states = state_names(acc)
    if "defunct" in states:
        return None
    ifaces = interfaces(acc)
    out = {
        "name": _safe(acc.get_name, "") or "",
        "states": states,
        "childCount": _safe(acc.get_child_count, 0) or 0,
    }
    txt = text_of(acc, ifaces)
    if txt is not None:
        if is_secret(role):
            out["valueLength"] = len(txt)
        else:
            out["value"] = txt
    cur, _ = value_range(acc, ifaces)
    if cur is not None and "value" not in out and not is_secret(role):
        out["value"] = _fmt_number(cur)
    if role == "combo box":
        _, selected = combo_options(acc)
        if selected is not None:
            out["selectedOption"] = selected
    return out


def content_hash(apps, budget=1500):
    """CRC of role/name/static text of showing nodes in active windows. Field values are left out."""
    import zlib  # noqa: PLC0415

    crc = 0
    left = [budget]

    def visit(acc, depth):
        if left[0] <= 0 or depth > 40:
            return
        left[0] -= 1
        states = state_names(acc)
        if depth > 0 and "showing" not in states:
            return
        nonlocal crc
        role = _safe(acc.get_role_name, "") or ""
        name = _safe(acc.get_name, "") or ""
        crc = zlib.crc32(f"{role}\x1f{name}\x1e".encode("utf-8", "replace"), crc)
        if role in ("label", "static", "heading", "paragraph", "caption", "status bar"):
            ifaces = interfaces(acc)
            txt = text_of(acc, ifaces) or ""
            crc = zlib.crc32(txt.encode("utf-8", "replace"), crc)
        for i in range(min(_safe(acc.get_child_count, 0) or 0, 2000)):
            child = _safe(lambda i=i: acc.get_child_at_index(i))
            if child is not None:
                visit(child, depth + 1)

    for app in apps:
        for w in top_windows(app):
            states = state_names(w)
            if "showing" in states or "visible" in states:
                visit(w, 0)
    return format(crc, "08x")


def focused_summary(apps):
    """Role and name of the focused element (no value), by a bounded search of showing windows."""
    budget = [800]

    def find(acc, depth):
        if budget[0] <= 0 or depth > 30:
            return None
        budget[0] -= 1
        states = state_names(acc)
        if "focused" in states:
            return acc
        if depth > 0 and "showing" not in states:
            return None
        for i in range(_safe(acc.get_child_count, 0) or 0):
            child = _safe(lambda i=i: acc.get_child_at_index(i))
            if child is None:
                continue
            hit = find(child, depth + 1)
            if hit is not None:
                return hit
        return None

    for app in apps:
        for w in top_windows(app):
            if "active" not in state_names(w):
                continue
            hit = find(w, 0)
            if hit is not None:
                return hit
    return None
