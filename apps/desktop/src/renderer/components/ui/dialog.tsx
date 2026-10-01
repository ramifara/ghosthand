// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  children,
  className,
  title,
  description,
  dismissible = true,
}: {
  children: ReactNode;
  className?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Approvals must be answered explicitly: no Escape, no outside click. */
  dismissible?: boolean;
}) {
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/45" />
      <DialogPrimitive.Content
        onEscapeKeyDown={block}
        onPointerDownOutside={block}
        onInteractOutside={block}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
          "rounded-md border border-line-strong bg-panel shadow-2xl",
          className,
        )}
      >
        <div className="border-b border-line px-5 pt-4 pb-3">
          <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-muted">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
