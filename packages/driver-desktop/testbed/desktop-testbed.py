#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Rami Fara and GhostHand contributors
"""GhostHand desktop testbed: a small GTK3 app with a profile form and a shopping list.

Every change is written to the JSON state file (`--state`), which the task oracles read. GTK3 exposes its
widgets over AT-SPI; Tk would not, which is why this is GTK and not Tk.

    python3 desktop-testbed.py --state /work/state.json [--seed default]
"""

import argparse
import json
import os
import sys
import tempfile
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Atk", "1.0")
from gi.repository import Atk, Gtk  # noqa: E402

PLANS = ("Free", "Pro", "Team")
SEEDS = {"default": ["Eggs", "Bread", "Coffee"], "empty": []}


class Testbed:
    def __init__(self, state_path, items):
        self.state_path = state_path
        self.items = list(items)
        self.saved = None
        self.events = []

        self.win = Gtk.Window(title="GhostHand Desktop Testbed")
        self.win.set_default_size(560, 640)
        self.win.connect("destroy", Gtk.main_quit)

        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        root.set_border_width(16)
        self.win.add(root)

        root.pack_start(self._heading("Profile"), False, False, 0)
        grid = Gtk.Grid(column_spacing=12, row_spacing=8)
        root.pack_start(grid, False, False, 0)
        self.name = self._entry(grid, 0, "Full name")
        self.email = self._entry(grid, 1, "Email")

        plan_label = Gtk.Label(label="Plan", xalign=0)
        self.plan = Gtk.ComboBoxText()
        for p in PLANS:
            self.plan.append_text(p)
        self.plan.set_active(0)
        plan_label.set_mnemonic_widget(self.plan)
        self.plan.get_accessible().set_name("Plan")
        grid.attach(plan_label, 0, 2, 1, 1)
        grid.attach(self.plan, 1, 2, 1, 1)

        self.newsletter = Gtk.CheckButton(label="Subscribe to the newsletter")
        grid.attach(self.newsletter, 1, 3, 1, 1)

        save = Gtk.Button(label="Save profile")
        save.connect("clicked", self.on_save)
        grid.attach(save, 1, 4, 1, 1)

        root.pack_start(Gtk.Separator(), False, False, 4)
        root.pack_start(self._heading("Shopping list"), False, False, 0)
        self.list = Gtk.ListBox()
        self.list.set_selection_mode(Gtk.SelectionMode.NONE)
        self.list.get_accessible().set_name("Shopping list")
        scroller = Gtk.ScrolledWindow()
        scroller.set_min_content_height(180)
        scroller.add(self.list)
        root.pack_start(scroller, True, True, 0)

        add_row = Gtk.Box(spacing=8)
        self.new_item = Gtk.Entry()
        self.new_item.get_accessible().set_name("New item")
        self.new_item.set_placeholder_text("New item")
        self.new_item.connect("activate", self.on_add)
        add = Gtk.Button(label="Add item")
        add.connect("clicked", self.on_add)
        add_row.pack_start(self.new_item, True, True, 0)
        add_row.pack_start(add, False, False, 0)
        root.pack_start(add_row, False, False, 0)

        self.status = Gtk.Label(label="Ready.", xalign=0)
        self.status.get_accessible().set_name("Status")
        root.pack_start(self.status, False, False, 0)

        self.render_list()
        self.write_state("start")
        self.win.show_all()

    def _heading(self, text):
        label = Gtk.Label(xalign=0)
        label.set_markup(f"<b>{text}</b>")
        label.get_accessible().set_role(Atk.Role.HEADING)
        return label

    def _entry(self, grid, row, text):
        label = Gtk.Label(label=text, xalign=0)
        entry = Gtk.Entry()
        entry.set_hexpand(True)
        label.set_mnemonic_widget(entry)
        entry.get_accessible().set_name(text)
        grid.attach(label, 0, row, 1, 1)
        grid.attach(entry, 1, row, 1, 1)
        return entry

    def render_list(self):
        for child in self.list.get_children():
            self.list.remove(child)
        for item in self.items:
            row = Gtk.ListBoxRow()
            box = Gtk.Box(spacing=8)
            box.set_border_width(4)
            label = Gtk.Label(label=item, xalign=0)
            remove = Gtk.Button(label="Remove")
            remove.get_accessible().set_name("Remove")
            remove.get_accessible().set_description(f"Remove {item} from the shopping list")
            remove.connect("clicked", self.on_remove, item)
            box.pack_start(label, True, True, 0)
            box.pack_start(remove, False, False, 0)
            row.add(box)
            row.get_accessible().set_name(item)
            self.list.add(row)
        self.list.show_all()

    def on_save(self, _button):
        name = self.name.get_text().strip()
        email = self.email.get_text().strip()
        if not name or "@" not in email:
            self.status.set_text("Please enter a full name and a valid email.")
            self.write_state("save_invalid")
            return
        self.saved = {
            "name": name,
            "email": email,
            "plan": self.plan.get_active_text(),
            "newsletter": self.newsletter.get_active(),
        }
        self.status.set_text("Profile saved.")
        self.write_state("save")

    def on_add(self, _widget):
        text = self.new_item.get_text().strip()
        if not text:
            self.status.set_text("Type an item first.")
            return
        self.items.append(text)
        self.new_item.set_text("")
        self.render_list()
        self.status.set_text(f"Added {text}.")
        self.write_state("add")

    def on_remove(self, _button, item):
        if item in self.items:
            self.items.remove(item)
        self.render_list()
        self.status.set_text(f"Removed {item}.")
        self.write_state("remove")

    def write_state(self, event):
        self.events.append({"t": int(time.time() * 1000), "event": event})
        state = {"version": 1, "profile": self.saved, "items": self.items, "events": self.events[-50:]}
        if not self.state_path:
            return
        folder = os.path.dirname(self.state_path) or "."
        os.makedirs(folder, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".state-")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f)
        os.chmod(tmp, 0o644)
        os.replace(tmp, self.state_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default=os.environ.get("GHOSTHAND_TESTBED_STATE", ""))
    ap.add_argument("--seed", default="default", choices=sorted(SEEDS))
    args = ap.parse_args()
    Testbed(args.state, SEEDS[args.seed])
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
