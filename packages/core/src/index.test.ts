// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { corePackageName } from "./index.ts";

describe("@ghosthand/core", () => {
  it("exports its package name", () => {
    expect(corePackageName).toBe("@ghosthand/core");
  });
});
