// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { protocolPackageName } from "./index.ts";

describe("@ghosthand/protocol", () => {
  it("exports its package name", () => {
    expect(protocolPackageName).toBe("@ghosthand/protocol");
  });
});
