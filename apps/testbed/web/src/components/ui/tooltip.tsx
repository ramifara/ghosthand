// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Radix Tooltip: shown on hover and keyboard focus, role="tooltip", described-by on the trigger.
import { Content, Portal, Provider, Root, Trigger } from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export { Provider as TooltipProvider };

/** Wraps a single focusable child (usually an icon-only button) with a tooltip. */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <Root>
      <Trigger asChild>{children}</Trigger>
      <Portal>
        <Content
          side="top"
          sideOffset={4}
          className="z-50 rounded bg-foreground px-2 py-1 text-xs text-background shadow"
        >
          {label}
        </Content>
      </Portal>
    </Root>
  );
}
