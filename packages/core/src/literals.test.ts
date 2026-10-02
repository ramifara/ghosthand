// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Unquoted text in goals: search phrases, "type x", "set y to x", labeled values, credentials.
import { describe, expect, it } from "vitest";
import { extractLiterals, MAX_TEXT_OPTIONS } from "./literals.ts";

describe("extractLiterals without quotes", () => {
  it.each([
    ["search for a vegan restaurant in berlin", ["vegan restaurant in berlin"]],
    ["go to google maps and search for a vegan restaurant in berlin", ["vegan restaurant in berlin"]],
    ["go to google and do a seatch for Jev and find the teams page of its builder company", ["Jev"]],
    ["go to google and do simple jev search", ["jev"]],
    ["change your handle to bob and save", ["bob"]],
    ["type hello world into the search box", ["hello world"]],
    ["post a comment with the text great work, thanks and submit", ["great work"]],
  ])("%s", (goal, expected) => {
    expect(extractLiterals(goal)).toEqual(expected);
  });

  it("offers an inline password next to an email, but not markdown emphasis", () => {
    expect(
      extractLiterals(
        "login with this cred ramiar374@gmail.com 9xWAkDj7K5Kxttf@ and **Turn handwriting on.**",
      ),
    ).toEqual(["ramiar374@gmail.com", "9xWAkDj7K5Kxttf@"]);
  });

  it("reads labeled values from a brief", () => {
    expect(extractLiterals("Email: bob@x.io\nPassword: hunter2!\nThen open settings")).toEqual([
      "bob@x.io",
      "hunter2!",
    ]);
  });

  it("keeps quoted text, emails and credentials when a long brief has more candidates than the cap", () => {
    const filler = Array.from({ length: 60 }, (_, i) => `Item ${i + 10} for Team Alpha${i}`).join(", ");
    const goal = `${filler}. Sign in with alice@example.com s3cret-Pw9 and set the title to "Q3 plan".`;
    const out = extractLiterals(goal);
    expect(out).toHaveLength(MAX_TEXT_OPTIONS);
    expect(out).toEqual(expect.arrayContaining(["alice@example.com", "s3cret-Pw9", "Q3 plan"]));
  });
});
