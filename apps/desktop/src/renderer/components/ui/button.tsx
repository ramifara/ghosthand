// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "amber";
export type ButtonSize = "sm" | "md" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 border border-transparent",
  secondary: "bg-panel text-ink border border-line-strong hover:bg-panel-2",
  ghost: "text-ink hover:bg-panel-2 border border-transparent",
  danger: "bg-danger-soft text-danger border border-danger/40 hover:border-danger",
  amber: "bg-amber-soft text-amber border border-amber/40 hover:border-amber",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
  icon: "h-8 w-8 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  asChild,
  className,
  type,
  ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        "inline-flex items-center rounded-[5px] font-medium whitespace-nowrap transition-colors select-none",
        "disabled:opacity-45 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
