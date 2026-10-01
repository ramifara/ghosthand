// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-line-strong border-b-2 bg-panel px-1 font-mono text-2xs text-muted">
      {children}
    </kbd>
  );
}
