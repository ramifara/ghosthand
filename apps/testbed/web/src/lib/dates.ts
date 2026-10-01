// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Calendar math on YYYY-MM-DD strings, all in UTC so the date picker never depends on the browser's zone.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface YearMonth {
  year: number;
  /** 0-11. */
  month: number;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function monthOf(iso: string): YearMonth {
  const d = toDate(iso);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const total = ym.year * 12 + ym.month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function monthTitle(ym: YearMonth): string {
  return `${MONTHS[ym.month]} ${ym.year}`;
}

/** "Monday, January 12, 2026". */
export function longDate(iso: string): string {
  const d = toDate(iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Weeks (Sunday first) covering the month; days outside it are null. */
export function monthGrid(ym: YearMonth): (string | null)[][] {
  const first = new Date(Date.UTC(ym.year, ym.month, 1));
  const days = new Date(Date.UTC(ym.year, ym.month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= days; day++) cells.push(toIso(new Date(Date.UTC(ym.year, ym.month, day))));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function sameMonth(iso: string, ym: YearMonth): boolean {
  const m = monthOf(iso);
  return m.year === ym.year && m.month === ym.month;
}
