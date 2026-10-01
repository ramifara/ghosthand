// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { knowledgePackageName } from "./index.ts";

describe("@ghosthand/knowledge", () => {
  it("exports its package name", () => {
    expect(knowledgePackageName).toBe("@ghosthand/knowledge");
  });
});
