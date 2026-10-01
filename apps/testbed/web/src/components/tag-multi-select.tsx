// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Multi-select for order tags: a button (aria-haspopup="listbox") opens a listbox with
// aria-multiselectable; options toggle on click, Space or Enter. Chosen tags show as removable chips.
import { ORDER_TAGS, type OrderTag } from "@ghosthand/testbed-kit/orders";
import { Check, ChevronDown, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { tid } from "../lib/tid.ts";

export interface TagMultiSelectProps {
  id: string;
  labelId: string;
  value: readonly OrderTag[];
  onChange(value: OrderTag[]): void;
}

export function TagMultiSelect({ id, labelId, value, onChange }: TagMultiSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  function toggle(tag: OrderTag) {
    const next = value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag];
    onChange(ORDER_TAGS.filter((t) => next.includes(t)));
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(ORDER_TAGS.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const tag = ORDER_TAGS[active];
      if (tag) toggle(tag);
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      setOpen(false);
      document.getElementById(id)?.focus();
    }
  }

  const optionId = (i: number) => `${listId}-option-${i}`;

  return (
    <fieldset
      ref={rootRef}
      aria-labelledby={labelId}
      className="m-0 min-w-0 space-y-1.5 border-0 p-0"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <ul
        aria-label="Selected tags"
        className="flex min-h-7 flex-wrap gap-1"
        {...tid("order.edit.tags.chips")}
      >
        {value.length === 0 ? <li className="text-xs text-muted">No tags</li> : null}
        {value.map((tag) => (
          <li
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-accent-soft px-2 py-0.5 text-xs"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => toggle(tag)}
              className="rounded-full p-0.5 hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="relative">
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${labelId} ${id}`}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex h-8 w-full items-center justify-between rounded-md border border-border bg-panel px-2.5 text-sm",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          )}
          {...tid("order.edit.tags")}
        >
          <span>{value.length === 0 ? "Choose tags" : `${value.length} selected`}</span>
          <ChevronDown aria-hidden="true" className="size-4 text-muted" />
        </button>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelId}
          aria-activedescendant={open ? optionId(active) : undefined}
          tabIndex={-1}
          hidden={!open}
          onKeyDown={onListKeyDown}
          className="absolute z-50 mt-1 w-full rounded-md border border-border bg-panel py-1 shadow-lg focus:outline-none"
          {...tid("order.edit.tags.options")}
        >
          {ORDER_TAGS.map((tag, i) => {
            const selected = value.includes(tag);
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: keys go to the listbox (aria-activedescendant pattern)
              <div
                key={tag}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActive(i);
                  toggle(tag);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm",
                  i === active ? "bg-accent-soft" : undefined,
                )}
              >
                <Check
                  aria-hidden="true"
                  className={cn("size-3.5 text-accent", selected ? "" : "invisible")}
                />
                {tag}
              </div>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
