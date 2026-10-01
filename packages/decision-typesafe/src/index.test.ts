// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { decisionTypesafePackageName } from "./index.ts";

describe("@ghosthand/decision-typesafe", () => {
  it("exports its package name", () => {
    expect(decisionTypesafePackageName).toBe("@ghosthand/decision-typesafe");
  });
});
