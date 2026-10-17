// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { WireResponse, WireUsage } from "./wire.ts";

describe("WireUsage", () => {
  it("accepts token counts", () => {
    expect(WireUsage.parse({ input_tokens: 12, output_tokens: 3 })).toEqual({
      input_tokens: 12,
      output_tokens: 3,
    });
  });

  it("accepts null token counts (SDK 0.7.0: the API may omit them)", () => {
    expect(WireUsage.parse({ input_tokens: null, output_tokens: null })).toEqual({
      input_tokens: null,
      output_tokens: null,
    });
  });
});

describe("WireResponse", () => {
  it("parses an envelope with null usage", () => {
    const r = WireResponse.safeParse({
      model: "jev-1.14.0",
      answers: { a: { type: "noul", noul: 0.5 } },
      usage: { input_tokens: null, output_tokens: null },
    });
    expect(r.success).toBe(true);
  });
});
