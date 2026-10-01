// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { actionsFor, hrefFor, riskFor, roleClassOf } from "./element-rules.ts";

describe("roleClassOf", () => {
  it("maps ARIA roles to coarse classes", () => {
    expect(roleClassOf("searchbox")).toBe("textbox");
    expect(roleClassOf("switch")).toBe("checkbox");
    expect(roleClassOf("combobox")).toBe("select");
    expect(roleClassOf("generic")).toBe("other");
  });
});

describe("actionsFor", () => {
  const facts = { tag: "", editable: false, pointer: false };
  it("offers operations by role", () => {
    expect(actionsFor({ ...facts, role: "textbox" })).toContain("set_value");
    expect(actionsFor({ ...facts, role: "checkbox" })).toContain("toggle");
    expect(actionsFor({ ...facts, role: "combobox" })).toContain("select_option");
    expect(actionsFor({ ...facts, role: "combobox", editable: true })).toContain("set_value");
    expect(actionsFor({ ...facts, role: "generic", pointer: true })).toContain("press");
    expect(actionsFor({ ...facts, role: "heading" })).toEqual(["scroll_into_view"]);
  });
});

describe("riskFor", () => {
  const base = { tag: "button", submits: false, pageOrigin: "https://app.test" };
  it("flags destructive words before anything else", () => {
    expect(riskFor({ ...base, role: "button", name: "Delete user", submits: true })).toBe("destructive");
    expect(riskFor({ ...base, role: "button", name: "Cancel subscription" })).toBe("destructive");
    expect(riskFor({ ...base, role: "button", name: "Cancel" })).toBe("unknown");
  });
  it("separates same-origin and external links", () => {
    expect(riskFor({ ...base, role: "link", name: "Docs", href: "https://app.test/docs" })).toBe("navigates");
    expect(riskFor({ ...base, role: "link", name: "Docs", href: "https://other.test/docs" })).toBe(
      "external",
    );
    expect(riskFor({ ...base, role: "link", name: "Mail", href: "mailto:a@b.c" })).toBe("external");
  });
  it("marks submit buttons and safe inputs", () => {
    expect(riskFor({ ...base, role: "button", name: "Save", submits: true })).toBe("submits");
    expect(riskFor({ ...base, role: "textbox", name: "Email" })).toBe("safe");
  });
});

describe("hrefFor", () => {
  it("shows paths for same-origin links and full URLs otherwise", () => {
    expect(hrefFor("https://app.test/a/b?x=1#top", "https://app.test")).toBe("/a/b?x=1#top");
    expect(hrefFor("https://other.test/a?q=1#h", "https://app.test")).toBe("https://other.test/a?q=1");
    expect(hrefFor("javascript:void(0)", "https://app.test")).toBe("javascript:");
  });
});
