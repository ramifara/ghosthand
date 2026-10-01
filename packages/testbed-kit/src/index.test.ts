// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { testbedKitPackageName } from "./index.ts";

describe("@ghosthand/testbed-kit", () => {
  it("exports its package name", () => {
    expect(testbedKitPackageName).toBe("@ghosthand/testbed-kit");
  });
});
