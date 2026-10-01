// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { recorderPackageName } from "./index.ts";

describe("@ghosthand/recorder", () => {
  it("exports its package name", () => {
    expect(recorderPackageName).toBe("@ghosthand/recorder");
  });
});
