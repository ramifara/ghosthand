// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { parseCodesignReport } from "./code-signature.ts";

describe("codesign report", () => {
  it("recognises an ad-hoc signature", () => {
    expect(
      parseCodesignReport(
        "Executable=/Applications/GhostHand.app\nIdentifier=dev.ghosthand\nSignature=adhoc\n",
      ),
    ).toBe(true);
  });
  it("recognises a Developer ID signature", () => {
    expect(
      parseCodesignReport(
        "Identifier=dev.ghosthand\nAuthority=Developer ID Application: Example (TEAM)\nAuthority=Apple Root CA\n",
      ),
    ).toBe(false);
  });
});
