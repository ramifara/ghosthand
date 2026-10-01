// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Modal dialog and side drawer on Radix Dialog: role="dialog", aria-modal, labelled by the title,
// focus trapped, Escape closes.
import { Close, Content, Description, Overlay, Portal, Root, Title } from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export { Close as DialogClose, Root as Dialog };

const layouts = {
  center: "top-1/2 left-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg",
  drawer: "top-0 right-0 h-full w-[min(26rem,100vw)] border-l",
} as const;

export function DialogContent({
  layout = "center",
  className,
  children,
  ...props
}: ComponentProps<typeof Content> & { layout?: keyof typeof layouts }) {
  return (
    <Portal>
      <Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Content
        aria-modal="true"
        className={cn(
          "fixed z-40 flex max-h-full flex-col border-border bg-panel shadow-xl focus:outline-none",
          layouts[layout],
          className,
        )}
        {...props}
      >
        {children}
        <Close
          aria-label="Close"
          className="absolute top-3 right-3 rounded p-1 text-muted hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X aria-hidden="true" className="size-4" />
        </Close>
      </Content>
    </Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("border-b border-border px-4 py-3 pr-10", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof Title>) {
  return <Title className={cn("text-base font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof Description>) {
  return <Description className={cn("mt-0.5 text-xs text-muted", className)} {...props} />;
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto px-4 py-3", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex justify-end gap-2 border-t border-border px-4 py-3", className)} {...props} />
  );
}
