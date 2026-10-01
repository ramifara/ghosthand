// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Snapshot } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import {
  controlSimilarity,
  normalizeLabel,
  sameScreen,
  screenFingerprint,
  urlPattern,
} from "./screen-fingerprint.ts";
import { fakeElement } from "./testing/scripted-computer.ts";

const snap = (url: string, names: string[], heading = "Orders"): Snapshot => ({
  id: "s",
  surface: "web",
  takenAt: 0,
  url,
  title: "t",
  viewport: { x: 0, y: 0, width: 1, height: 1 },
  elements: [
    fakeElement("h", { role: "heading", name: heading }),
    ...names.map((n, i) => fakeElement(`e${i}`, { role: "button", name: n })),
  ],
  text: "",
  tokenEstimate: 1,
  quality: { elementCount: 1, unnamedInteractive: 0, score: 1 },
  narrowed: false,
});

describe("urlPattern", () => {
  it("templates ids, keeps query keys only and drops the hash", () => {
    expect(urlPattern("http://127.0.0.1:4400/orders/ORD-1042?tab=notes&page=2#x")).toBe(
      "http://127.0.0.1:4400/orders/:id?page&tab",
    );
    expect(urlPattern("https://a.test/u/12345/posts/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "https://a.test/u/:n/posts/:id",
    );
    expect(urlPattern("https://a.test/settings/")).toBe("https://a.test/settings");
    expect(urlPattern(undefined)).toBe("about:blank");
  });
});

describe("screenFingerprint", () => {
  it("is robust to dynamic ids, counters and data in names", () => {
    const a = screenFingerprint(snap("http://x.test/orders/17", ["Save", "Delete 3 items", "alice@x.test"]));
    const b = screenFingerprint(snap("http://x.test/orders/42", ["Save", "Delete 5 items", "bob@x.test"]));
    expect(a.key).toBe(b.key);
    expect(a.controls).toEqual(["button:delete # items", "button:save"]);
  });

  it("tells different screens apart and matches a screen with a changed control", () => {
    const orders = screenFingerprint(snap("http://x.test/orders", ["Save", "Export", "Filter", "Next"]));
    const profile = screenFingerprint(snap("http://x.test/profile", ["Save", "Export"], "Profile"));
    expect(orders.key).not.toBe(profile.key);
    expect(sameScreen(orders, profile)).toBe(false);
    const moved = screenFingerprint(
      snap("http://x.test/orders", ["Save", "Export", "Filter", "Next", "Undo"], "Orders (3)"),
    );
    expect(moved.key).not.toBe(orders.key);
    expect(sameScreen(orders, moved)).toBe(true);
  });

  it("normalizes labels and compares control sets", () => {
    expect(normalizeLabel('  "Delete 12 orders…"  ')).toBe("delete # orders");
    expect(controlSimilarity([], [])).toBe(1);
    expect(controlSimilarity(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
  });
});
