// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { cliPackageName } from "./index.ts";

describe("@ghosthand/cli", () => {
  it("exports its package name", () => {
    expect(cliPackageName).toBe("@ghosthand/cli");
  });
});
