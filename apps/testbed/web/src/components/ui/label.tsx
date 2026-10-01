// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { Root } from "@radix-ui/react-label";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export function Label({ className, ...props }: ComponentProps<typeof Root>) {
  return <Root className={cn("text-xs font-medium text-foreground", className)} {...props} />;
}
