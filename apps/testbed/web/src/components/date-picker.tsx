// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Date field: a labelled text input (YYYY-MM-DD) plus a calendar button that opens a popover dialog
// with a month grid (role="grid", roving tabindex, arrows/PageUp/PageDown/Home/End).
// "Today" is the testbed clock, so the calendar opens on the same month in every run.
import { Content, Portal, Root, Trigger } from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import {
  addDays,
  addMonths,
  isIsoDate,
  longDate,
  monthGrid,
  monthOf,
  monthTitle,
  sameMonth,
  WEEKDAY_SHORT,
  type YearMonth,
} from "../lib/dates.ts";
import { serverToday } from "../lib/server-clock.ts";
import { tid } from "../lib/tid.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";

export interface DatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  testId: string;
  invalid?: boolean;
}

export function DatePicker({ id, label, value, onChange, testId, invalid }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-1">
        <Input
          id={id}
          name={id}
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          aria-describedby={hintId}
          aria-invalid={invalid ? true : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-36 font-mono"
          {...tid(testId)}
        />
        <Root open={open} onOpenChange={setOpen}>
          <Trigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label={`Choose ${label} date`}
              {...tid(`${testId}.open`)}
            >
              <CalendarDays aria-hidden="true" className="size-4" />
            </Button>
          </Trigger>
          <Portal>
            <Content
              ref={contentRef}
              align="start"
              sideOffset={4}
              aria-label={`${label} calendar`}
              onOpenAutoFocus={(e) => {
                // Start on the selected (or today's) day, like a native date picker.
                e.preventDefault();
                contentRef.current
                  ?.querySelector<HTMLButtonElement>('button[data-date][tabindex="0"]')
                  ?.focus();
              }}
              className="z-50 rounded-md border border-border bg-panel p-3 shadow-lg focus:outline-none"
              {...tid(`${testId}.calendar`)}
            >
              <Calendar
                value={isIsoDate(value) ? value : undefined}
                onPick={(iso) => {
                  onChange(iso);
                  setOpen(false);
                }}
              />
            </Content>
          </Portal>
        </Root>
      </div>
      <p id={hintId} className="text-xs text-muted">
        Format YYYY-MM-DD.
      </p>
    </div>
  );
}

function Calendar({ value, onPick }: { value: string | undefined; onPick(iso: string): void }) {
  const today = serverToday();
  const titleId = useId();
  const [focused, setFocused] = useState(value ?? today);
  const [month, setMonth] = useState<YearMonth>(monthOf(value ?? today));
  const gridRef = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }, [focused, month]);

  function focusDate(iso: string) {
    moved.current = true;
    setFocused(iso);
    if (!sameMonth(iso, month)) setMonth(monthOf(iso));
  }

  function showMonth(delta: number) {
    const next = addMonths(month, delta);
    setMonth(next);
    setFocused(`${next.year}-${String(next.month + 1).padStart(2, "0")}-01`);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = moves[e.key];
    if (step !== undefined) {
      e.preventDefault();
      focusDate(addDays(focused, step));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const ym = addMonths(monthOf(focused), e.key === "PageUp" ? -1 : 1);
      const day = Math.min(Number(focused.slice(8)), 28);
      focusDate(`${ym.year}-${String(ym.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }

  return (
    <div className="w-64 space-y-2">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Previous month"
          onClick={() => showMonth(-1)}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </Button>
        <h2 id={titleId} className="text-sm font-medium" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <Button type="button" variant="ghost" size="sm" aria-label="Next month" onClick={() => showMonth(1)}>
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <table
        ref={gridRef}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the APG date picker is a table with role="grid"
        role="grid"
        aria-labelledby={titleId}
        className="w-full text-center"
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {WEEKDAY_SHORT.map((d) => (
              <th key={d} scope="col" className="py-1 text-xs font-normal text-muted">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week) => (
            <tr key={week.find(Boolean) ?? "empty"}>
              {week.map((iso, i) =>
                iso === null ? (
                  <td key={`blank-${i}`} />
                ) : (
                  // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole lint/a11y/useFocusableInteractive: APG grid cell; the day button inside takes focus
                  <td key={iso} role="gridcell" aria-selected={iso === value}>
                    <button
                      type="button"
                      data-date={iso}
                      tabIndex={iso === focused ? 0 : -1}
                      aria-label={longDate(iso)}
                      aria-current={iso === today ? "date" : undefined}
                      onClick={() => onPick(iso)}
                      className={cn(
                        "size-8 rounded text-sm hover:bg-accent-soft",
                        "focus-visible:outline-2 focus-visible:outline-accent",
                        iso === value ? "bg-accent text-accent-foreground hover:bg-accent" : undefined,
                        iso === today && iso !== value ? "font-semibold text-accent" : undefined,
                      )}
                    >
                      {Number(iso.slice(8))}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
