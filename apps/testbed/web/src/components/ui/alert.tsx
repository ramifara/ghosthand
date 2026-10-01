// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const variants = {
  info: { className: "border-border bg-accent-soft text-foreground", Icon: Info },
  success: { className: "border-good bg-good-soft text-good", Icon: CircleCheck },
  destructive: { className: "border-bad bg-bad-soft text-bad", Icon: CircleAlert },
} as const;

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
}

/** Errors default to role="alert"; other variants to role="status" so screen readers announce them politely. */
export function Alert({ variant = "info", className, children, role, ...props }: AlertProps) {
  const { className: tone, Icon } = variants[variant];
  return (
    <div
      role={role ?? (variant === "destructive" ? "alert" : "status")}
      className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", tone, className)}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
