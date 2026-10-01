// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Resolves the active variant: server value from the last reset, overridden by query-string flags.
// Query overrides are kept in localStorage until the next reset (tracked by resetId).
import {
  DEFAULT_VARIANT,
  ROBUSTNESS_FLAGS,
  type Variant,
  VariantOverrides,
} from "@ghosthand/testbed-kit/variant";

export const VARIANT_STORAGE_KEY = "ghosthand.testbed.variant";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function readStored(store: KeyValueStore | undefined, resetId: number): VariantOverrides {
  const raw = store?.getItem(VARIANT_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { resetId?: unknown; overrides?: unknown };
    if (parsed.resetId === resetId) return VariantOverrides.parse(parsed.overrides);
  } catch {
    // fall through: corrupt entries are dropped
  }
  store?.removeItem(VARIANT_STORAGE_KEY);
  return {};
}

/** Query-string flags the web app honors; each one is validated on its own so one bad value drops only itself. */
const QUERY_FLAGS = ["testids", "a11y", ...ROBUSTNESS_FLAGS] as const;

function queryOverrides(search: string): VariantOverrides {
  const params = new URLSearchParams(search);
  const out: Record<string, unknown> = {};
  for (const flag of QUERY_FLAGS) {
    if (!params.has(flag)) continue;
    const one = VariantOverrides.safeParse({ [flag]: params.get(flag) });
    if (one.success) Object.assign(out, one.data);
  }
  return VariantOverrides.parse(out);
}

export function resolveVariant(
  server: { variant: Variant; resetId: number },
  search: string,
  store: KeyValueStore | undefined,
): Variant {
  const query = queryOverrides(search);
  const stored = readStored(store, server.resetId);
  const overrides: VariantOverrides = { ...stored, ...query };
  if (Object.keys(query).length > 0) {
    store?.setItem(VARIANT_STORAGE_KEY, JSON.stringify({ resetId: server.resetId, overrides }));
  }
  const resolved: Variant = {
    testids: overrides.testids ?? server.variant.testids ?? DEFAULT_VARIANT.testids,
    a11y: overrides.a11y ?? server.variant.a11y ?? DEFAULT_VARIANT.a11y,
  };
  // L6 flags: present only when set, so the default variant stays exactly { testids, a11y }.
  for (const flag of ROBUSTNESS_FLAGS) {
    const value = overrides[flag] ?? server.variant[flag];
    if (value !== undefined) Object.assign(resolved, { [flag]: value });
  }
  return resolved;
}

let active: Variant = DEFAULT_VARIANT;

export function setActiveVariant(variant: Variant): void {
  active = variant;
}

export function activeVariant(): Variant {
  return active;
}
