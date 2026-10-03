// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Long pages: the text excerpt keeps the start, the lines naming the goal and the end; `new_text` shows
// what the last action produced wherever it appeared.
import { describe, expect, it } from "vitest";
import { newTextLines, pageTextExcerpt } from "./state-builder.ts";

const results = Array.from({ length: 200 }, (_, i) => `Result ${i}: bears and salmon at Brooks Falls`).join(
  "\n",
);

describe("page text excerpt", () => {
  it("leaves short text alone and clips long text without goal words", () => {
    expect(pageTextExcerpt("short", 100)).toBe("short");
    expect(pageTextExcerpt("x".repeat(500), 100)).toHaveLength(100);
  });

  it("keeps the line that names the most goal words from the middle of a long page", () => {
    const text = `${results}\nFeed the bear a salmon\n${results}`;
    const out = pageTextExcerpt(text, 2400, ["feed", "bear"]);
    expect(out.length).toBeLessThanOrEqual(2400);
    expect(out).toContain("Feed the bear a salmon");
    expect(out.startsWith("Result 0")).toBe(true);
  });

  it("keeps the end of a long page when asked to", () => {
    const out = pageTextExcerpt(`${results}\nThe bear is fed`, 2400, [], { tail: true });
    expect(out.length).toBeLessThanOrEqual(2400);
    expect(out.endsWith("The bear is fed")).toBe(true);
  });
});

describe("new text", () => {
  it("lists lines that were not on the page before, in page order", () => {
    expect(newTextLines(undefined, "a\nb")).toEqual([]);
    expect(newTextLines("a\nb", "a\nThe bear is fed\nb\nSaved")).toEqual(["The bear is fed", "Saved"]);
  });

  it("lists nothing when most of the page is new (another page, a closed dialog)", () => {
    const before = "Delete order?\nCancel\nDelete order";
    const after = Array.from({ length: 20 }, (_, i) => `Order row ${i}`).join("\n");
    expect(newTextLines(before, after)).toEqual([]);
  });
});
