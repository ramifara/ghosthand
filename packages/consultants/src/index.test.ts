// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { consultantsPackageName } from "./index.ts";

describe("@ghosthand/consultants", () => {
  it("exports its package name", () => {
    expect(consultantsPackageName).toBe("@ghosthand/consultants");
  });
});
