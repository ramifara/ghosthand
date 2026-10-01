// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Confirm dialog on Radix AlertDialog: role="alertdialog", aria-modal, labelled and described;
// clicking outside does not dismiss it.
import { Cancel, Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export { Cancel as AlertDialogCancel, Root as AlertDialog };

export function AlertDialogContent({ className, children, ...props }: ComponentProps<typeof Content>) {
  return (
    <Portal>
      <Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Content
        aria-modal="true"
        className={cn(
          "fixed top-1/2 left-1/2 z-40 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
          "space-y-3 rounded-lg border border-border bg-panel p-4 shadow-xl focus:outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </Content>
    </Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof Title>) {
  return <Title className={cn("text-base font-semibold", className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof Description>) {
  return <Description className={cn("text-sm text-muted", className)} {...props} />;
}
