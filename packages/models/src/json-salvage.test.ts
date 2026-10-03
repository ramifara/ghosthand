// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { firstJsonObject, salvageObject } from "./json-salvage.ts";

const Draft = z.object({ kind: z.enum(["focus", "text", "none"]), content: z.string().min(1) });

describe("JSON salvage", () => {
  it("finds the object inside prose and fences", () => {
    expect(
      firstJsonObject('Sure! ```json\n{"kind":"focus","content":"Click \\"Economy\\" {link}"}\n``` ok'),
    ).toEqual({
      kind: "focus",
      content: 'Click "Economy" {link}',
    });
  });

  it("validates against the schema and rejects what does not fit", () => {
    expect(salvageObject('{"kind":"focus","content":"Open Economy"}', Draft)).toEqual({
      kind: "focus",
      content: "Open Economy",
    });
    expect(salvageObject('{"kind":"maybe","content":"x"}', Draft)).toBeUndefined();
    expect(salvageObject("no json here", Draft)).toBeUndefined();
    expect(salvageObject(undefined, Draft)).toBeUndefined();
  });
});
