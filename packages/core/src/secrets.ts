// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Names → values for secrets. Models only ever see "[input:NAME]"; drivers resolve values at action time.

const SENSITIVE_KEY =
  /password|passwd|secret|otp|cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token/i;
const MIN_SECRET_LENGTH = 4;

export const secretPlaceholder = (name: string): string => `[input:${name}]`;

export class SecretsRegistry {
  readonly #values = new Map<string, string>();

  constructor(entries: Iterable<[string, string]> = []) {
    for (const [name, value] of entries) this.register(name, value);
  }

  register(name: string, value: string): void {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`invalid secret name: ${name}`);
    this.#values.set(name, value);
  }

  has(name: string): boolean {
    return this.#values.has(name);
  }

  names(): string[] {
    return [...this.#values.keys()];
  }

  /** Only drivers call this, right before input. */
  resolve(name: string): string | undefined {
    return this.#values.get(name);
  }

  /** Name of the secret whose value equals `text`, if any. */
  match(text: string): string | undefined {
    for (const [name, value] of this.#values) if (value.length > 0 && value === text) return name;
    return undefined;
  }

  /** Replaces every registered value (longest first) with its placeholder. */
  redact(text: string): string {
    let out = text;
    const entries = [...this.#values]
      .filter(([, v]) => v.length >= MIN_SECRET_LENGTH)
      .sort((a, b) => b[1].length - a[1].length);
    for (const [name, value] of entries) {
      if (out.includes(value)) out = out.split(value).join(secretPlaceholder(name));
      const encoded = JSON.stringify(value).slice(1, -1);
      if (encoded !== value && out.includes(encoded)) out = out.split(encoded).join(secretPlaceholder(name));
    }
    return out;
  }

  /** Deep-redacts a JSON-like value: registered values everywhere, and any value under a sensitive key. */
  redactValue<T>(value: T): T {
    return redactDeep(value, this) as T;
  }
}

function redactDeep(value: unknown, registry: SecretsRegistry, key?: string): unknown {
  if (typeof value === "string") {
    if (key !== undefined && SENSITIVE_KEY.test(key) && value.length > 0) return "[redacted]";
    return registry.redact(value);
  }
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, registry));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, registry, k);
    return out;
  }
  return value;
}

export const isSensitiveKey = (key: string): boolean => SENSITIVE_KEY.test(key);
