// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { AriaSnapshotSchema, flattenAriaSnapshot } from "./aria-tree.ts";

// Shape of `page.ariaSnapshotJSON({mode: "ai", boxes: true})` (trimmed), including a password value
// that Playwright renders as the textbox's text.
const SNAPSHOT: unknown = [
  {
    role: "main",
    ref: "e2",
    children: [
      { role: "heading", name: "Sign in", level: 1, ref: "e3", box: { x: 8, y: 8, width: 300, height: 37 } },
      { role: "textbox", name: "Email", ref: "e4", text: "ada@example.com" },
      { role: "textbox", name: "Password", ref: "e5", text: "hunter2-secret" },
      {
        role: "combobox",
        name: "Theme",
        ref: "e6",
        children: [
          { role: "option", name: "Light", selected: true },
          { role: "option", name: "Dark" },
        ],
      },
      { role: "checkbox", name: "Remember me", checked: true, ref: "e7" },
      {
        role: "generic",
        ref: "e8",
        cursor: "pointer",
        text: "Clickable card",
        children: [{ role: "generic", ref: "e9", cursor: "pointer", text: "inner" }],
      },
      { role: "button", ref: "e10", children: ["Save ", "draft"] },
      { role: "button", name: "Hidden", ref: "e11", ariaHidden: true },
      "Some page text",
      {
        role: "iframe",
        ref: "e12",
        children: [
          { role: "generic", ref: "f2e1", children: [{ role: "button", name: "Pay", ref: "f2e2" }] },
        ],
      },
    ],
  },
];

describe("flattenAriaSnapshot", () => {
  const tree = flattenAriaSnapshot(AriaSnapshotSchema.parse(SNAPSHOT));
  const byRef = new Map(tree.nodes.map((n) => [n.ref, n]));

  it("keeps interactive, pointer and heading nodes in document order", () => {
    expect(tree.nodes.map((n) => n.ref)).toEqual(["e3", "e4", "e5", "e6", "e7", "e8", "e10", "f2e2"]);
  });

  it("never collects textbox values as page text", () => {
    expect(tree.text).not.toContain("hunter2-secret");
    expect(tree.text).not.toContain("ada@example.com");
    expect(tree.text).toContain("Some page text");
    expect(tree.text).toContain("Sign in");
  });

  it("rebuilds names from content and keeps option names", () => {
    expect(byRef.get("e10")?.name).toBe("Save draft");
    expect(byRef.get("e8")?.name).toBe("Clickable card inner");
    expect(byRef.get("e6")?.optionNames).toEqual(["Light", "Dark"]);
    expect(byRef.get("e7")?.checked).toBe(true);
  });

  it("assigns frames by hosting iframe, not by ref prefix", () => {
    expect(byRef.get("e4")?.frameKey).toBe("");
    expect(byRef.get("f2e2")?.frameKey).toBe("e12");
    expect(byRef.get("f2e2")?.ancestors).toEqual(["e2", "e12", "f2e1"]);
    expect(tree.iframes).toEqual([{ ref: "e12", frameKey: "" }]);
  });

  it("rejects malformed snapshots", () => {
    expect(AriaSnapshotSchema.safeParse([{ name: "no role" }]).success).toBe(false);
  });
});

describe("flattenAriaSnapshot with markup extras", () => {
  const BOARD: unknown = [
    {
      role: "list",
      name: "Done",
      ref: "e2",
      children: [
        { role: "listitem", ref: "e3", children: ["Fix login timeout"] },
        { role: "listitem", ref: "e4", children: ["Plain item"] },
      ],
    },
    {
      role: "row",
      ref: "e5",
      children: [
        { role: "cell", name: "Nimbus", ref: "e6" },
        { role: "cell", name: "4 members", ref: "e7" },
      ],
    },
  ];
  const snapshot = AriaSnapshotSchema.parse(BOARD);

  it("leaves non-interactive roles out without extras", () => {
    expect(flattenAriaSnapshot(snapshot).nodes).toEqual([]);
  });

  it("keeps drop zones as containers and named items from their content", () => {
    const extra = new Map<string, "item" | "zone">([
      ["e2", "zone"],
      ["e3", "item"],
      ["e5", "item"],
    ]);
    const tree = flattenAriaSnapshot(snapshot, extra);
    expect(tree.nodes.map((n) => [n.ref, n.role, n.name])).toEqual([
      ["e2", "list", "Done"],
      ["e3", "listitem", "Fix login timeout"],
      ["e5", "row", "Nimbus 4 members"],
    ]);
    // An item's text is its name, not loose page text; unmarked siblings stay page text.
    expect(tree.text).toContain("Plain item");
    expect(tree.text).not.toContain("Fix login timeout");
  });
});
