// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const variants = {
  default: "bg-accent text-accent-foreground hover:opacity-90",
  outline: "border border-border bg-panel text-foreground hover:bg-accent-soft",
  ghost: "text-foreground hover:bg-accent-soft",
} as const;

const sizes = { default: "h-8 px-3", sm: "h-7 px-2 text-xs" } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Render the child element (e.g. a link) with button styling. */
  asChild?: boolean;
}

export function Button({ variant = "default", size = "default", asChild, className, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium motion-safe:transition-opacity",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
