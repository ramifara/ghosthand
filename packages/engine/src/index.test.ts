// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { enginePackageName } from "./index.ts";

describe("@ghosthand/engine", () => {
  it("exports its package name", () => {
    expect(enginePackageName).toBe("@ghosthand/engine");
  });
});
