// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useId } from "react";

export function SwitchField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-2">
      <div>
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {hint ? <p className="mt-0.5 max-w-prose text-muted">{hint}</p> : null}
      </div>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        {...(disabled !== undefined ? { disabled } : {})}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full border border-line-strong bg-panel-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-ink/70 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-ink" />
      </SwitchPrimitive.Root>
    </div>
  );
}
