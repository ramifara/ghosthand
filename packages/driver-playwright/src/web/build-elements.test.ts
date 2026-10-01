// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { SecretsRegistry } from "@ghosthand/core";
import { Element } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import type { FlatNode } from "./aria-tree.ts";
import type { FrameGeometry } from "./build-elements.ts";
import { buildElements } from "./build-elements.ts";
import type { DomInfo } from "./in-page/page-types.ts";
import { capElements, measureQuality } from "./rank-elements.ts";
import { SecretScope } from "./secret-scope.ts";

const node = (ref: string, role: string, name: string, extra: Partial<FlatNode> = {}): FlatNode => ({
  ref,
  role,
  name,
  frameKey: "",
  ancestors: [],
  disabled: false,
  expanded: false,
  active: false,
  invalid: false,
  selected: false,
  pointer: false,
  optionNames: [],
  ...extra,
});

const dom = (extra: Partial<DomInfo> = {}): DomInfo => ({
  tag: "button",
  valueKind: "none",
  required: false,
  disabled: false,
  readonly: false,
  invalid: false,
  focused: false,
  hidden: false,
  region: "main",
  submits: false,
  rect: { x: 10, y: 10, width: 80, height: 20 },
  ...extra,
});

const viewport = { x: 0, y: 0, width: 1000, height: 700 };
const frames = new Map<string, FrameGeometry>([
  [
    "",
    {
      path: "main",
      offset: { x: 0, y: 0 },
      clip: viewport,
      region: undefined,
      hidden: false,
      origin: "https://app.test",
    },
  ],
  [
    "e9",
    {
      path: "main > Payment",
      offset: { x: 100, y: 200 },
      clip: { x: 100, y: 200, width: 300, height: 100 },
      region: "dialog",
      hidden: false,
      origin: "https://app.test",
    },
  ],
]);
const scope = new SecretScope(new SecretsRegistry([["PASSWORD", "hunter2-secret"]]));

describe("buildElements", () => {
  const nodes = [
    node("e1", "textbox", "Password"),
    node("e2", "button", "Edit"),
    node("e3", "button", "Edit"),
    node("e4", "button", "Ghost"),
    node("e5", "textbox", "Card", { frameKey: "e9" }),
    node("e6", "link", "Docs", { url: "https://other.test/docs" }),
    node("e7", "button", "Far"),
  ];
  const info = new Map<string, DomInfo | null>([
    [
      "e1",
      dom({
        tag: "input",
        inputType: "password",
        valueKind: "password",
        value: "hunter2-secret",
        region: "form",
      }),
    ],
    ["e2", dom({ context: "Alice · Admin" })],
    ["e3", dom({ context: "Bob · Editor" })],
    ["e4", dom({ hidden: true })],
    [
      "e5",
      dom({
        tag: "input",
        valueKind: "text",
        value: "Ada",
        region: "form",
        rect: { x: 5, y: 5, width: 50, height: 20 },
      }),
    ],
    ["e6", dom({ tag: "a", href: "https://other.test/docs" })],
    ["e7", dom({ rect: { x: 10, y: 5000, width: 80, height: 20 } })],
  ]);
  const elements = buildElements({ nodes, dom: info, frames, snapshotId: "s3", scope });
  const byName = (name: string) => elements.filter((e) => e.name === name);

  it("produces schema-valid elements and drops hidden ones", () => {
    for (const el of elements) expect(() => Element.parse(el)).not.toThrow();
    expect(byName("Ghost")).toHaveLength(0);
    expect(elements[0]?.token).toBe("e1s3");
  });

  it("redacts the password to its placeholder", () => {
    expect(byName("Password")[0]?.value).toBe("[input:PASSWORD]");
    expect(JSON.stringify(elements)).not.toContain("hunter2-secret");
  });

  it("gives duplicate names distinct stable ids through their context", () => {
    const [a, b] = byName("Edit");
    expect(a?.stableId).not.toBe(b?.stableId);
    expect(a?.context).toBe("Alice · Admin");
  });

  it("maps frame content to top-viewport bounds, frame path and the iframe's dialog region", () => {
    const card = byName("Card")[0];
    expect(card?.bounds).toEqual({ x: 105, y: 205, width: 50, height: 20 });
    expect(card?.frame).toBe("main > Payment");
    expect(card?.region).toBe("dialog");
  });

  it("marks offscreen elements and external links", () => {
    expect(byName("Far")[0]?.states).toContain("offscreen");
    expect(byName("Far")[0]?.visibleBounds).toBeNull();
    expect(byName("Docs")[0]?.risk).toBe("external");
    expect(byName("Docs")[0]?.href).toBe("https://other.test/docs");
  });

  it("caps by region rank and keeps document order", () => {
    const capped = capElements(elements, "", 3);
    expect(capped.elements.map((e) => e.name)).toEqual(["Password", "Edit", "Card"]);
    expect(capped.omitted).toBe(3);
    const tiny = capElements(elements, "", 200, 50);
    expect(tiny.narrowed).toBe(true);
    expect(tiny.elements.length).toBeLessThan(elements.length);
    expect(measureQuality(elements)).toEqual({ elementCount: 6, unnamedInteractive: 0, score: 1 });
  });
});
