# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""Key names: the protocol uses Playwright names ("Enter", "Control", "ArrowUp"); X11 uses keysyms."""

KEYSYMS = {
    "enter": "Return",
    "return": "Return",
    "escape": "Escape",
    "esc": "Escape",
    "tab": "Tab",
    "backspace": "BackSpace",
    "delete": "Delete",
    "insert": "Insert",
    "space": "space",
    " ": "space",
    "arrowup": "Up",
    "arrowdown": "Down",
    "arrowleft": "Left",
    "arrowright": "Right",
    "up": "Up",
    "down": "Down",
    "left": "Left",
    "right": "Right",
    "home": "Home",
    "end": "End",
    "pageup": "Prior",
    "pagedown": "Next",
    "control": "ctrl",
    "ctrl": "ctrl",
    "controlormeta": "ctrl",
    "shift": "shift",
    "alt": "alt",
    "meta": "super",
    "super": "super",
    "cmd": "super",
    "command": "super",
    "capslock": "Caps_Lock",
    "contextmenu": "Menu",
}

MODIFIERS = {"ctrl", "shift", "alt", "super"}


def keysym(name):
    """Maps one key name to an X keysym; single characters and F-keys pass through."""
    if len(name) == 1:
        return name
    low = name.lower()
    if low in KEYSYMS:
        return KEYSYMS[low]
    if low.startswith("f") and low[1:].isdigit():
        return "F" + low[1:]
    return name


def combo(keys):
    """["Control", "a"] or ["Control+a"] -> "ctrl+a" for xdotool."""
    parts = []
    for k in keys:
        for p in (k.split("+") if len(k) > 1 else [k]):
            if p:
                parts.append(keysym(p))
    return "+".join(parts)
