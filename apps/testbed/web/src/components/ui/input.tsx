// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

const field =
  "w-full rounded-md border border-border bg-panel px-2.5 text-sm text-foreground placeholder:text-muted " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
  "aria-invalid:border-bad aria-invalid:outline-bad disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-16 py-1.5", className)} {...props} />;
}
