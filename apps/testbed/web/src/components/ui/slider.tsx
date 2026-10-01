// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Radix Slider: one thumb with role="slider", aria-valuemin/max/now, arrows/Home/End/PageUp/PageDown.
import { Range, Root, Thumb, Track } from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export function Slider({
  className,
  thumbLabelledBy,
  thumbProps,
  ...props
}: ComponentProps<typeof Root> & {
  /** id of the visible label; Radix puts role="slider" on the thumb, so the name goes there. */
  thumbLabelledBy: string;
  thumbProps?: Record<string, string>;
}) {
  return (
    <Root
      className={cn("relative flex h-5 w-full touch-none items-center select-none", className)}
      {...props}
    >
      <Track className="relative h-1.5 grow rounded-full bg-border">
        <Range className="absolute h-full rounded-full bg-accent" />
      </Track>
      <Thumb
        aria-labelledby={thumbLabelledBy}
        className="block size-4 rounded-full border-2 border-accent bg-panel shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        {...thumbProps}
      />
    </Root>
  );
}
