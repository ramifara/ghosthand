// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { RpcNode } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { actionsFor, ariaRole, roleClassOf, statesFor } from "./role-map.ts";

const node = (over: Partial<RpcNode>): RpcNode => ({
  ref: 1,
  parent: 0,
  depth: 1,
  role: "push button",
  name: "Save",
  secret: false,
  states: ["enabled", "sensitive", "showing", "visible"],
  interfaces: [],
  actions: [],
  bounds: null,
  window: 0,
  childCount: 0,
  ...over,
});

describe("ariaRole", () => {
  it("maps AT-SPI roles, deciding `text` by editability", () => {
    expect(ariaRole("linux-x11", node({ role: "push button" }))).toBe("button");
    expect(ariaRole("linux-x11", node({ role: "text", interfaces: ["Text", "EditableText"] }))).toBe(
      "textbox",
    );
    expect(ariaRole("linux-x11", node({ role: "text", interfaces: ["Text"] }))).toBe("StaticText");
    expect(ariaRole("linux-wayland", node({ role: "check box" }))).toBe("checkbox");
    expect(ariaRole("linux-x11", node({ role: "combo box" }))).toBe("combobox");
    expect(ariaRole("linux-x11", node({ role: "list item" }))).toBe("option");
    expect(ariaRole("linux-x11", node({ role: "something new" }))).toBe("generic");
  });

  it("maps UIA control types: Text is static, Edit is a textbox, toggle buttons are switches", () => {
    expect(ariaRole("windows", node({ role: "Text" }))).toBe("StaticText");
    expect(ariaRole("windows", node({ role: "Edit", interfaces: ["Value"] }))).toBe("textbox");
    expect(ariaRole("windows", node({ role: "Button", interfaces: ["Invoke"] }))).toBe("button");
    expect(ariaRole("windows", node({ role: "Button", interfaces: ["Toggle"] }))).toBe("switch");
    expect(ariaRole("windows", node({ role: "Document", interfaces: ["Value"], states: ["enabled"] }))).toBe(
      "textbox",
    );
  });

  it("maps AX roles and subroles", () => {
    expect(ariaRole("macos", node({ role: "AXButton" }))).toBe("button");
    expect(ariaRole("macos", node({ role: "AXCheckBox", subrole: "AXSwitch" }))).toBe("switch");
    expect(ariaRole("macos", node({ role: "AXRadioButton", subrole: "AXTabButton" }))).toBe("tab");
    expect(ariaRole("macos", node({ role: "AXPopUpButton" }))).toBe("combobox");
    expect(ariaRole("macos", node({ role: "AXSecureTextField" }))).toBe("textbox");
  });
});

describe("actions and states", () => {
  it("offers operations by role", () => {
    expect(actionsFor("textbox", node({ interfaces: ["Text", "EditableText"] }))).toContain("set_value");
    expect(actionsFor("checkbox", node({}))).toEqual(["toggle", "focus", "scroll_into_view"]);
    expect(actionsFor("combobox", node({}))).toContain("select_option");
    expect(actionsFor("button", node({}))[0]).toBe("press");
    expect(roleClassOf("switch")).toBe("checkbox");
  });

  it("derives protocol states from native ones", () => {
    expect(statesFor("checkbox", node({ states: ["sensitive"] }))).toEqual(["unchecked"]);
    expect(statesFor("checkbox", node({ states: ["sensitive", "checked"] }))).toEqual(["checked"]);
    expect(statesFor("button", node({ states: [] }))).toContain("disabled");
    expect(statesFor("textbox", node({ states: ["enabled", "focused"], interfaces: ["Text"] }))).toEqual([
      "focused",
      "readonly",
    ]);
    expect(statesFor("switch", node({ states: ["enabled", "pressed"] }))).toContain("checked");
  });
});
