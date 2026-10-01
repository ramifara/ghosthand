// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Native select and checkbox, styled to match Input. Native controls keep their built-in semantics.
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "block h-8 rounded-md border border-border bg-panel px-2 text-sm text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 accent-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}
