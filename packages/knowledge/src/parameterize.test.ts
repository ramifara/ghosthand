// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { bindIntent, bindValue, parameterize, templateValue } from "./parameterize.ts";

describe("parameterize", () => {
  it("turns used literals into placeholders, longest first, whole tokens only", () => {
    const p = parameterize('Set the daily email limit to 45 and the name to "Alice Moreau", not 450.', [
      "45",
      "Alice Moreau",
    ]);
    expect(p.intent).toBe('Set the daily email limit to {{p2}} and the name to "{{p1}}", not 450.');
    expect(p.params).toEqual([
      { name: "p1", example: "Alice Moreau" },
      { name: "p2", example: "45" },
    ]);
    expect(templateValue({ type: "set_value", value: "45" }, p.replacements)).toEqual({
      type: "set_value",
      value: "{{p2}}",
    });
  });

  it("ignores literals the instruction does not contain", () => {
    expect(parameterize("Sign in", ["alice"]).params).toEqual([]);
  });
});

describe("bindIntent", () => {
  it("binds a new instruction to the template and rejects others", () => {
    const t = 'Set the daily email limit to {{p2}} and the name to "{{p1}}", not 450.';
    expect(bindIntent(t, 'Set the daily email   limit to 30 and the name to "Bob", not 450.')).toEqual({
      p1: "Bob",
      p2: "30",
    });
    expect(bindIntent(t, "Delete every order")).toBeUndefined();
    expect(bindIntent("Sign in as {{p1}} then greet {{p1}}", "Sign in as al then greet al")).toEqual({
      p1: "al",
    });
    expect(bindIntent("Sign in as {{p1}} then greet {{p1}}", "Sign in as al then greet bo")).toBeUndefined();
  });

  it("substitutes placeholders deeply", () => {
    expect(bindValue({ a: ["x {{p1}}", { b: "{{p2}}" }], n: 3 }, { p1: "1", p2: "two" })).toEqual({
      a: ["x 1", { b: "two" }],
      n: 3,
    });
  });
});
