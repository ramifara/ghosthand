// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Async autocomplete for customers, following the ARIA 1.2 combobox pattern: an input with
// role="combobox" that controls a listbox; aria-activedescendant tracks the highlighted option.
// Results come from the server after a delay, so a stale list never wins over the latest query.
import { Check } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { api, type Customer } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { tid } from "../lib/tid.ts";
import { Input } from "./ui/input.tsx";

const DEBOUNCE_MS = 150;

export interface CustomerComboboxProps {
  id: string;
  value: Customer | null;
  onChange(value: Customer | null): void;
  invalid?: boolean;
  describedBy?: string;
}

export function CustomerCombobox({ id, value, onChange, invalid, describedBy }: CustomerComboboxProps) {
  const listId = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<Customer[]>([]);
  const [active, setActive] = useState(-1);
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const ticket = ++latest.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api.customers(text).then((res) => {
        if (ticket !== latest.current) return;
        setLoading(false);
        const found = res.ok ? res.value.customers : [];
        setOptions(found);
        setActive(found.length > 0 ? 0 : -1);
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, open]);

  function choose(customer: Customer) {
    onChange(customer);
    setText(customer.name);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open) {
      const option = options[active];
      if (option && !loading) {
        e.preventDefault();
        choose(option);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  const optionId = (i: number) => `${listId}-option-${i}`;
  const expanded = open && (loading || options.length > 0 || text.trim() !== "");

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 && !loading ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value && e.target.value !== value.name) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        {...tid("order.edit.customer")}
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Customers"
        hidden={!expanded}
        className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-lg"
        {...tid("order.edit.customer.options")}
      >
        {loading ? (
          <div role="presentation" className="px-2.5 py-1.5 text-xs text-muted" aria-live="polite">
            Searching…
          </div>
        ) : options.length === 0 ? (
          <div role="presentation" className="px-2.5 py-1.5 text-xs text-muted">
            No customers match.
          </div>
        ) : (
          options.map((c, i) => (
            <div
              key={c.id}
              id={optionId(i)}
              role="option"
              aria-selected={value?.id === c.id}
              tabIndex={-1}
              // mousedown, not click: keep focus in the input so blur doesn't close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm",
                i === active ? "bg-accent-soft" : undefined,
              )}
            >
              <Check
                aria-hidden="true"
                className={cn("size-3.5 text-accent", value?.id === c.id ? "visible" : "invisible")}
              />
              <span>{c.name}</span>
              <span className="ml-auto text-xs text-muted">{c.email}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
