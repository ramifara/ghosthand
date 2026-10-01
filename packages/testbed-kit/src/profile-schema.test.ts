// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { createRng } from "./prng.ts";
import { validateProfile } from "./profile-schema.ts";

const valid = { name: " Alice ", handle: "alice-dev", title: "", website: "https://alice.dev", bio: "" };

describe("validateProfile", () => {
  it("accepts and trims a valid profile", () => {
    const res = validateProfile(valid);
    expect(res).toEqual({ ok: true, value: { ...valid, name: "Alice" } });
  });

  it("returns one message per invalid field", () => {
    const res = validateProfile({ ...valid, name: "  ", handle: "Bob!", website: "alice.dev" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.fieldErrors).sort()).toEqual(["handle", "name", "website"]);
    expect(res.fieldErrors.website).toBe("Website must be a full https:// URL.");
  });
});

describe("createRng", () => {
  it("is deterministic per seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const seqA = [a.next(), a.int(1, 6), a.hex(8)];
    expect([b.next(), b.int(1, 6), b.hex(8)]).toEqual(seqA);
    expect(c.next()).not.toBe(seqA[0]);
  });
});
