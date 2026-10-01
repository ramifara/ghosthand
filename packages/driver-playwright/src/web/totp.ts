// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// TOTP codes from a registered base32 secret (RFC 6238 defaults: SHA1, 6 digits, 30 s).
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import { Secret, TOTP } from "otpauth";

export interface TotpOptions {
  digits?: number;
  period?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
  /** Milliseconds since the epoch; defaults to now. */
  timestamp?: number;
}

/** Accepts a bare base32 secret or an `otpauth://totp/...` URI. */
export function generateTotp(secret: string, opts: TotpOptions = {}): Result<string, string> {
  try {
    if (secret.startsWith("otpauth://")) {
      const url = new URL(secret);
      const fromUri = url.searchParams.get("secret");
      if (!fromUri) return err("otpauth URI without a secret");
      const digits = Number(url.searchParams.get("digits") ?? opts.digits ?? 6);
      const period = Number(url.searchParams.get("period") ?? opts.period ?? 30);
      const algorithm = url.searchParams.get("algorithm") ?? opts.algorithm ?? "SHA1";
      const totp = new TOTP({ secret: Secret.fromBase32(fromUri), digits, period, algorithm });
      return ok(totp.generate(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : {}));
    }
    const totp = new TOTP({
      secret: Secret.fromBase32(secret.replace(/\s+/g, "").toUpperCase()),
      digits: opts.digits ?? 6,
      period: opts.period ?? 30,
      algorithm: opts.algorithm ?? "SHA1",
    });
    return ok(totp.generate(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : {}));
  } catch {
    // Never echo the secret in the message.
    return err("not a valid base32 TOTP secret");
  }
}

/** Secrets whose name ends in `_TOTP` are TOTP seeds; typing one types the current code instead. */
export const isTotpSecretName = (name: string): boolean => /_TOTP$/.test(name);
