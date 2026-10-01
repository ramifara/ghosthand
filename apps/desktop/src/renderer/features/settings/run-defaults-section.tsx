// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Budgets and run defaults. Testbed tasks keep their own budgets; these apply to free-text goals.
import type { Settings } from "@ghosthand/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { SwitchField } from "../../components/ui/switch.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";

export function RunDefaultsSection() {
  const qc = useQueryClient();
  const ids = { steps: useId(), seconds: useId(), usd: useId() };
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const [budget, setBudget] = useState<Settings["budget"]>();
  useEffect(() => {
    if (settings.data) setBudget(settings.data.budget);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => call("settings.set", patch),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
  if (!settings.data || !budget) return null;
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <div className="grid max-w-2xl gap-6">
      <section aria-labelledby="budget-h">
        <h3 id="budget-h" className="label mb-2">
          Budget per run
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Steps" htmlFor={ids.steps}>
            <Input
              id={ids.steps}
              type="number"
              min={1}
              value={budget.steps}
              onChange={(e) => setBudget({ ...budget, steps: num(e.target.value) })}
              className="num"
            />
          </Field>
          <Field label="Seconds" htmlFor={ids.seconds} hint="Takeover time does not count.">
            <Input
              id={ids.seconds}
              type="number"
              min={1}
              value={budget.seconds}
              onChange={(e) => setBudget({ ...budget, seconds: num(e.target.value) })}
              className="num"
            />
          </Field>
          <Field label="USD" htmlFor={ids.usd}>
            <Input
              id={ids.usd}
              type="number"
              min={0}
              step={0.01}
              value={budget.usd}
              onChange={(e) => setBudget({ ...budget, usd: num(e.target.value) })}
              className="num"
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={() => save.mutate({ budget })} disabled={save.isPending}>
            Save budget
          </Button>
          {save.error ? <span className="text-danger">{errorMessage(save.error)}</span> : null}
        </div>
      </section>
      <SwitchField
        label="Show the browser window by default"
        hint="Turn off for unattended runs. Takeover needs a visible window."
        checked={settings.data.showBrowser}
        onChange={(showBrowser) => save.mutate({ showBrowser })}
      />
    </div>
  );
}

export function DownloadsSection() {
  return (
    <div className="max-w-2xl rounded-md border border-dashed border-line-strong p-6">
      <p className="font-medium">Local speech models arrive with voice mode (Phase 4)</p>
      <p className="mt-1 text-muted">
        Moonshine ships by default; Whisper models for other languages will download here with size, checksum
        and progress.
      </p>
    </div>
  );
}
