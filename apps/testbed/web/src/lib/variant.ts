// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Resolves the active variant: server value from the last reset, overridden by query-string flags.
// Query overrides are kept in localStorage until the next reset (tracked by resetId).
import { DEFAULT_VARIANT, type Variant, VariantOverrides } from "@ghosthand/testbed-kit/variant";

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

export function resolveVariant(
  server: { variant: Variant; resetId: number },
  search: string,
  store: KeyValueStore | undefined,
): Variant {
  const params = new URLSearchParams(search);
  const fromQuery = VariantOverrides.safeParse({
    ...(params.has("testids") ? { testids: params.get("testids") } : {}),
    ...(params.has("a11y") ? { a11y: params.get("a11y") } : {}),
  });
  const query: VariantOverrides = fromQuery.success ? fromQuery.data : {};
  const stored = readStored(store, server.resetId);
  const overrides: VariantOverrides = { ...stored, ...query };
  if (query.testids !== undefined || query.a11y !== undefined) {
    store?.setItem(VARIANT_STORAGE_KEY, JSON.stringify({ resetId: server.resetId, overrides }));
  }
  return {
    testids: overrides.testids ?? server.variant.testids ?? DEFAULT_VARIANT.testids,
    a11y: overrides.a11y ?? server.variant.a11y ?? DEFAULT_VARIANT.a11y,
  };
}

let active: Variant = DEFAULT_VARIANT;

export function setActiveVariant(variant: Variant): void {
  active = variant;
}

export function activeVariant(): Variant {
  return active;
}
