// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { buildCandidates } from "./candidates.ts";
import { focusHits, focusTerms } from "./focus-terms.ts";
import { fakeElement, ScriptedComputer } from "./testing/scripted-computer.ts";

describe("focus terms", () => {
  it("keeps the content words of a goal", () => {
    expect(
      focusTerms("go to google, search for fat bear and feed that bear that showes up on the screen"),
    ).toEqual(["fat", "bear", "feed"]);
  });

  it("counts the goal words an element names", () => {
    const terms = focusTerms("feed the bear");
    expect(focusHits({ name: "Feed the bear a salmon" }, terms)).toBe(2);
    expect(focusHits({ name: "Fat bear 12", context: "Brooks Falls" }, terms)).toBe(1);
    expect(focusHits({ name: "Share" }, terms)).toBe(0);
  });

  it("offers the element that names the goal even when it is past the per-head cap", async () => {
    const links = Array.from({ length: 300 }, (_, i) =>
      fakeElement(`l${i}`, { role: "link", name: `Fat bear ${i}` }),
    );
    const feed = fakeElement("feed", { role: "button", name: "Feed the bear a salmon", region: "other" });
    const computer = new ScriptedComputer({
      screens: { s: { url: "https://x.test/", title: "x", elements: [...links, feed] } },
      start: "s",
      transition: () => undefined,
    });
    const snap = await computer.observe();
    if (!snap.ok) throw new Error("observe");
    const plain = buildCandidates(snap.value, { maxPerHead: 50 });
    expect(plain.press.map((e) => e.token)).not.toContain("feed");
    const focused = buildCandidates(snap.value, { maxPerHead: 50, focusTerms: focusTerms("feed the bear") });
    expect(focused.press.map((e) => e.token)).toContain("feed");
    // Survivors keep the usual order (main-region links first, the "other" region button last).
    expect(focused.press.map((e) => e.token)).toEqual([
      ...Array.from({ length: 49 }, (_, i) => `l${i}`),
      "feed",
    ]);
  });

  it("offers the same list as without goal words when nothing is cut", async () => {
    const els = Array.from({ length: 10 }, (_, i) =>
      fakeElement(`b${i}`, { role: "button", name: i === 7 ? "Undo" : `Delete row for Lior Weber ${i}` }),
    );
    const computer = new ScriptedComputer({
      screens: { s: { url: "https://x.test/", title: "x", elements: els } },
      start: "s",
      transition: () => undefined,
    });
    const snap = await computer.observe();
    if (!snap.ok) throw new Error("observe");
    const terms = focusTerms("Delete Lior Weber's order, then restore it with Undo");
    const a = buildCandidates(snap.value).press.map((e) => e.token);
    const b = buildCandidates(snap.value, { focusTerms: terms }).press.map((e) => e.token);
    expect(b).toEqual(a);
  });
});
