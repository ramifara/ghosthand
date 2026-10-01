// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Radix Accordion: header buttons with aria-expanded/aria-controls; collapsed panels are not rendered.
import { Content, Header, Item, Root, Trigger } from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export { Root as Accordion };

export function AccordionItem({ className, ...props }: ComponentProps<typeof Item>) {
  return <Item className={cn("border-b border-border last:border-b-0", className)} {...props} />;
}

export function AccordionTrigger({ className, children, ...props }: ComponentProps<typeof Trigger>) {
  return (
    <Header className="m-0 text-sm font-medium">
      <Trigger
        className={cn(
          "group flex w-full items-center justify-between px-1 py-2 text-left hover:text-accent",
          "focus-visible:outline-2 focus-visible:outline-accent",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted motion-safe:transition-transform group-data-[state=open]:rotate-180"
        />
      </Trigger>
    </Header>
  );
}

export function AccordionContent({ className, ...props }: ComponentProps<typeof Content>) {
  return <Content className={cn("px-1 pb-3 text-sm", className)} {...props} />;
}
