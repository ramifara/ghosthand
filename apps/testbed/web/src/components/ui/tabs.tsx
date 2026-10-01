// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Radix Tabs: tablist/tab/tabpanel roles, arrow-key navigation, panels labelled by their tab.
import { Content, List, Root, Trigger } from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export { Root as Tabs };

export function TabsList({ className, ...props }: ComponentProps<typeof List>) {
  return <List className={cn("flex gap-1 border-b border-border", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof Trigger>) {
  return (
    <Trigger
      className={cn(
        "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-muted",
        "hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent",
        "data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof Content>) {
  return (
    <Content
      className={cn("pt-4 focus-visible:outline-2 focus-visible:outline-accent", className)}
      {...props}
    />
  );
}
