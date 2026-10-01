// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { evalsPackageName } from "./index.ts";

describe("@ghosthand/evals", () => {
  it("exports its package name", () => {
    expect(evalsPackageName).toBe("@ghosthand/evals");
  });
});
