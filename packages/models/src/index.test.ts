// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { modelsPackageName } from "./index.ts";

describe("@ghosthand/models", () => {
  it("exports its package name", () => {
    expect(modelsPackageName).toBe("@ghosthand/models");
  });
});
