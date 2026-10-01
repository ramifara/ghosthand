// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { mcpPackageName } from "./index.ts";

describe("@ghosthand/mcp", () => {
  it("exports its package name", () => {
    expect(mcpPackageName).toBe("@ghosthand/mcp");
  });
});
