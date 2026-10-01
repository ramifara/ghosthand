// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { qaPackageName } from "./index.ts";

describe("@ghosthand/qa", () => {
  it("exports its package name", () => {
    expect(qaPackageName).toBe("@ghosthand/qa");
  });
});
