// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L3: revenue for a date range picked with two date pickers.
import { formatMoney } from "@ghosthand/testbed-kit/orders";
import { type FormEvent, useState } from "react";
import { DatePicker } from "../components/date-picker.tsx";
import { RequireSession } from "../components/require-session.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { api, type Revenue } from "../lib/api.ts";
import { isIsoDate } from "../lib/dates.ts";
import { tid } from "../lib/tid.ts";

export function ReportsPage() {
  return <RequireSession what="see reports">{() => <RevenueReport />}</RequireSession>;
}

function RevenueReport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<Revenue | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(undefined);
    if (!isIsoDate(from) || !isIsoDate(to)) {
      setError("Enter both dates as YYYY-MM-DD.");
      return;
    }
    if (from > to) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setError(undefined);
    setPending(true);
    const res = await api.revenue(from, to);
    setPending(false);
    if (res.ok) setResult(res.value);
    else setError(res.message);
  }

  return (
    <Card className="max-w-xl" aria-labelledby="reports-title">
      <CardHeader>
        <CardTitle as="h1" id="reports-title" className="text-base">
          Revenue report
        </CardTitle>
        <CardDescription>
          Totals for orders placed in a date range, both ends included. Cancelled orders don't count.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-start gap-4"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
          {...tid("reports.form")}
        >
          <DatePicker
            id="report-from"
            label="From"
            value={from}
            onChange={setFrom}
            testId="reports.from"
            invalid={error !== undefined && !isIsoDate(from)}
          />
          <DatePicker
            id="report-to"
            label="To"
            value={to}
            onChange={setTo}
            testId="reports.to"
            invalid={error !== undefined && !isIsoDate(to)}
          />
          <Button type="submit" className="mt-5" disabled={pending} {...tid("reports.run")}>
            {pending ? "Running…" : "Run report"}
          </Button>
        </form>
        {error ? (
          <Alert variant="destructive" {...tid("reports.error")}>
            {error}
          </Alert>
        ) : null}
        {result ? (
          <section
            aria-labelledby="report-result-title"
            className="rounded-md border border-border p-3"
            {...tid("reports.result")}
          >
            <h2 id="report-result-title" className="text-sm font-semibold">
              {`Revenue from ${result.from} to ${result.to}`}
            </h2>
            <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Total revenue</dt>
              <dd className="font-mono" {...tid("reports.total")}>
                {formatMoney(result.totalCents)}
              </dd>
              <dt className="text-muted">Orders counted</dt>
              <dd className="font-mono" {...tid("reports.count")}>
                {result.count}
              </dd>
            </dl>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
