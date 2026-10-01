// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { SecretsRegistry } from "@ghosthand/core";
import { Element, type RpcSnapshot } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { buildElements, capElements, desktopToken, redactNodeValue, slug } from "./build-elements.ts";
import { gtkTestbedSnapshot } from "./test-support.ts";

const build = (snapshot: RpcSnapshot, secrets = new SecretsRegistry()) =>
  buildElements({ snapshot, platform: "linux-x11", boundsTrust: "exact", snapshotId: "d1", secrets });

describe("buildElements on the recorded GTK testbed", () => {
  const table = build(gtkTestbedSnapshot());

  it("produces schema-valid elements with tokens of this snapshot", () => {
    expect(table.elements.length).toBeGreaterThan(8);
    for (const el of table.elements) {
      expect(Element.safeParse(el).success).toBe(true);
      expect(el.token).toMatch(/^e\d+d1$/);
      expect(table.refs.get(el.token)).toBeTypeOf("number");
    }
  });

  it("maps roles, values, options and risk", () => {
    const byName = (role: string, name: string) =>
      table.elements.find((e) => e.role === role && e.name === name);
    expect(byName("textbox", "Full name")?.value).toBe("Ada Lovelace");
    expect(byName("textbox", "Email")?.value).toBe("<empty>");
    expect(byName("combobox", "Plan")).toMatchObject({ value: "Free", options: ["Free", "Pro", "Team"] });
    expect(byName("checkbox", "Subscribe to the newsletter")?.actions[0]).toBe("toggle");
    expect(byName("button", "Save profile")?.risk).toBe("submits");
    expect(byName("button", "Add item")?.risk).toBe("unknown");
    // Labels and headings are page text, not targets.
    expect(table.elements.some((e) => e.role === "StaticText" || e.role === "heading")).toBe(false);
    expect(table.text).toContain("Profile");
    expect(table.text).toContain("Shopping list");
  });

  it("gives same-named row buttons their row as context and distinct stable ids", () => {
    const removes = table.elements.filter((e) => e.name === "Remove");
    expect(removes.map((e) => e.context)).toEqual(["Eggs", "Bread", "Coffee"]);
    expect(removes.every((e) => e.risk === "destructive")).toBe(true);
    expect(new Set(removes.map((e) => e.stableId)).size).toBe(3);
    expect(removes[0]?.stableId).toMatch(/^atspi:button:remove:[0-9a-f]{4}$/);
    expect(table.elements.find((e) => e.name === "Add item")?.stableId).toBe("atspi:button:add-item");
  });

  it("lists the window as a region", () => {
    expect(table.regions).toEqual([
      expect.objectContaining({
        id: "window-ghosthand-desktop-testbed",
        kind: "main",
        label: "GhostHand Desktop Testbed",
      }),
    ]);
  });

  it("redacts registered secrets in values and names", () => {
    const secrets = new SecretsRegistry([["PROFILE_NAME", "Ada Lovelace"]]);
    const t = build(gtkTestbedSnapshot(), secrets);
    expect(t.elements.find((e) => e.name === "Full name")?.value).toBe("[input:PROFILE_NAME]");
    expect(JSON.stringify(t)).not.toContain("Ada Lovelace");
  });

  it("never exposes secret field values and drops names copied from values", () => {
    const snap = gtkTestbedSnapshot();
    const nodes = snap.nodes.map((n) =>
      n.name === "Full name" && n.role === "text"
        ? { ...n, role: "password text", secret: true, value: undefined, valueLength: 7 }
        : n.name === "Email" && n.role === "text"
          ? { ...n, name: "typed@example.com", value: "typed@example.com" }
          : n,
    );
    const t = build({ ...snap, nodes });
    const pw = t.elements.find((e) => e.name === "Full name");
    expect(pw?.value).toBe("<filled>");
    expect(t.secretTokens.has(pw?.token ?? "")).toBe(true);
    // The email field's name was its typed value: the preceding label names it instead.
    expect(t.elements.find((e) => e.value === "typed@example.com")?.name).toBe("Email");
  });
});

describe("helpers", () => {
  it("slugs, tokens and value redaction", () => {
    expect(slug("Save profile…")).toBe("save-profile");
    expect(slug("")).toBe("unnamed");
    expect(desktopToken(12, "d3")).toBe("e12d3");
    const reg = new SecretsRegistry([["PW", "hunter22"]]);
    expect(redactNodeValue("hunter22", undefined, false, reg)).toBe("[input:PW]");
    expect(redactNodeValue(undefined, 0, true, reg)).toBe("<empty>");
    expect(redactNodeValue("", undefined, false, reg)).toBe("<empty>");
  });

  it("caps the table, keeping dialogs first", () => {
    const t = build(gtkTestbedSnapshot());
    const capped = capElements(t.elements, t.text, 3);
    expect(capped.elements).toHaveLength(3);
    expect(capped.omitted).toBe(t.elements.length - 3);
  });
});
