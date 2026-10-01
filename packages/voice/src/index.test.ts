// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { voicePackageName } from "./index.ts";

describe("@ghosthand/voice", () => {
  it("exports its package name", () => {
    expect(voicePackageName).toBe("@ghosthand/voice");
  });
});
