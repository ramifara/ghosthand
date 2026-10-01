// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export interface CatalogError {
  readonly kind: "invalid";
  readonly message: string;
  /** Dotted path of the offending field, when known. */
  readonly path?: string;
}
