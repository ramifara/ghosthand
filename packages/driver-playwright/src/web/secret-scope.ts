// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The driver's view of secrets: the injected registry plus values the driver generates itself
// (TOTP codes), so both are redacted from snapshots, evidence and traces. A capture can add transient
// values (whatever sits in password fields right now) so a page that echoes them is redacted too.
import { isSensitiveKey, SecretsRegistry, secretPlaceholder } from "@ghosthand/core";

const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-number|cc-csc)\b/i;
const MAX_VALUE_CHARS = 200;
const MIN_TRANSIENT_LENGTH = 4;
export const TRANSIENT_PLACEHOLDER = "<filled>";

export class SecretScope {
  readonly #registry: SecretsRegistry;
  readonly #generated: SecretsRegistry;
  readonly #transient: string[];

  constructor(
    registry: SecretsRegistry = new SecretsRegistry(),
    generated = new SecretsRegistry(),
    transient: string[] = [],
  ) {
    this.#registry = registry;
    this.#generated = generated;
    this.#transient = transient;
  }

  /** A scope that also redacts `values` (unregistered secrets seen in password fields) as `<filled>`. */
  withTransient(values: Iterable<string>): SecretScope {
    const extra = [...new Set(values)]
      .filter((v) => v.length >= MIN_TRANSIENT_LENGTH && this.match(v) === undefined)
      .sort((a, b) => b.length - a.length);
    return extra.length === 0 ? this : new SecretScope(this.#registry, this.#generated, extra);
  }

  resolve(name: string): string | undefined {
    return this.#registry.resolve(name);
  }

  has(name: string): boolean {
    return this.#registry.has(name);
  }

  /** Remembers a generated value (e.g. a TOTP code) under `name` so it is redacted like a secret. */
  remember(name: string, value: string): void {
    this.#generated.register(name, value);
  }

  match(text: string): string | undefined {
    return this.#registry.match(text) ?? this.#generated.match(text);
  }

  redact(text: string): string {
    let out = this.#generated.redact(this.#registry.redact(text));
    for (const v of this.#transient) if (out.includes(v)) out = out.split(v).join(TRANSIENT_PLACEHOLDER);
    return out;
  }

  /** Every registered and generated value, longest first, for byte-level redaction (traces). */
  values(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const reg of [this.#registry, this.#generated])
      for (const name of reg.names()) {
        const v = reg.resolve(name);
        if (v !== undefined && v.length >= 4) out.push([name, v]);
      }
    return out.sort((a, b) => b[1].length - a[1].length);
  }
}

export interface FieldFacts {
  valueKind: "none" | "text" | "password" | "select" | "editable";
  inputType?: string | undefined;
  fieldName?: string | undefined;
  fieldId?: string | undefined;
  autocomplete?: string | undefined;
}

/** Password inputs and fields whose name, id or autocomplete marks them as secret. */
export function isSecretField(f: FieldFacts): boolean {
  if (f.valueKind === "password" || f.inputType === "password") return true;
  if (f.autocomplete && SENSITIVE_AUTOCOMPLETE.test(f.autocomplete)) return true;
  return [f.fieldName, f.fieldId].some((k) => k !== undefined && isSensitiveKey(k));
}

/**
 * Redacted element value: `<empty>`, `[input:NAME]` when it equals a registered secret, `<filled>` for
 * secret fields, otherwise the visible text with any registered value replaced.
 */
export function redactFieldValue(
  raw: string | undefined,
  f: FieldFacts,
  scope: SecretScope,
): string | undefined {
  if (f.valueKind === "none" || raw === undefined) return undefined;
  if (raw.length === 0) return "<empty>";
  const name = scope.match(raw);
  if (name !== undefined) return secretPlaceholder(name);
  if (isSecretField(f)) return "<filled>";
  const visible = scope.redact(raw.replace(/\s+/g, " ").trim());
  return visible.length > MAX_VALUE_CHARS ? `${visible.slice(0, MAX_VALUE_CHARS - 1)}…` : visible;
}
