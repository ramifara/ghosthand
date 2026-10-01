// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

export type BadgeTone = "neutral" | "accent" | "amber" | "danger" | "ok";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line-strong text-muted",
  accent: "border-accent/50 text-accent bg-accent-soft",
  amber: "border-amber/50 text-amber bg-amber-soft",
  danger: "border-danger/50 text-danger bg-danger-soft",
  ok: "border-ok/50 text-ok",
};

export function Badge({
  tone = "neutral",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-2xs uppercase tracking-wide leading-4",
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
