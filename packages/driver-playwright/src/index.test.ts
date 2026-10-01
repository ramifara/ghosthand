// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { driverPlaywrightPackageName } from "./index.ts";

describe("@ghosthand/driver-playwright", () => {
  it("exports its package name", () => {
    expect(driverPlaywrightPackageName).toBe("@ghosthand/driver-playwright");
  });
});
