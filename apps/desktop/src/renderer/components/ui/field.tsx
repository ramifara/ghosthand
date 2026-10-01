// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Labelled inputs. Selects are native <select> elements: fully keyboard and screen-reader friendly.
import * as LabelPrimitive from "@radix-ui/react-label";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const control =
  "w-full rounded-[5px] border border-line-strong bg-panel px-2.5 text-[13px] text-ink placeholder:text-faint " +
  "hover:border-faint focus-visible:border-accent disabled:opacity-50";

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <LabelPrimitive.Root htmlFor={htmlFor} className="label">
        {label}
      </LabelPrimitive.Root>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-8", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "py-2 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "h-8 pr-7", className)} {...rest} />;
}
