// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `tid("login.submit")` adds a data-testid only when the `testids` variant is on.
import { activeVariant } from "./variant.ts";

export type TestIdProps = { "data-testid"?: string };

export function tid(id: string): TestIdProps {
  return activeVariant().testids === "on" ? { "data-testid": id } : {};
}
