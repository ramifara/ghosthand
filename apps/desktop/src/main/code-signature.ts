// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Whether this macOS app is only ad-hoc signed (no Developer ID). The Keychain ties its permissions to
// a verifiable signature, so an ad-hoc app is asked for the login password on every launch and "Always
// Allow" never sticks; the secret store then keeps its own key instead of using the Keychain.
import { execFile } from "node:child_process";

/** Resolves true when `codesign` reports an ad-hoc signature for the bundle at `appPath`. */
export function isAdHocSigned(appPath: string, timeoutMs = 3000): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/codesign",
      ["-dv", "--verbose=2", appPath],
      { timeout: timeoutMs, encoding: "utf8" },
      (error, stdout, stderr) => {
        // codesign prints its report on stderr; an unsigned bundle is an error and counts as ad-hoc too.
        if (error && !stderr) return resolve(true);
        resolve(parseCodesignReport(`${stdout}\n${stderr}`));
      },
    );
  });
}

/** Pure: true when the report has `Signature=adhoc` or no `Authority=` line at all. */
export function parseCodesignReport(report: string): boolean {
  if (/^Signature=adhoc$/m.test(report)) return true;
  return !/^Authority=/m.test(report);
}
