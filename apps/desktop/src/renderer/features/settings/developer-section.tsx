// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Developer switches (plumbing mode, previews, keyring fallback) and the doctor.
import type { Settings } from "@ghosthand/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { SwitchField } from "../../components/ui/switch.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";
import { cn } from "../../lib/cn.ts";

export function DeveloperSection() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const info = useQuery({ queryKey: ["app-info"], queryFn: () => call("app.info", {}) });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => call("settings.set", patch),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      void qc.invalidateQueries({ queryKey: ["chatgpt"] });
      void qc.invalidateQueries({ queryKey: ["secrets"] });
    },
  });
  const doctor = useMutation({ mutationFn: () => call("doctor.run", {}) });
  const s = settings.data;
  if (!s) return null;
  return (
    <div className="grid max-w-2xl gap-4">
      <div className="divide-y divide-line">
        <SwitchField
          label="Plumbing mode"
          hint="Without a TypeSafe key, runs use a rule-based stand-in for Jev (no network, no cost). For checking the app, not the agent."
          checked={s.devPlumbingMode}
          onChange={(devPlumbingMode) => save.mutate({ devPlumbingMode })}
        />
        <SwitchField
          label="ChatGPT plan (preview)"
          hint="Enables Sign in with ChatGPT under Providers. OpenAI's plan usage for third-party apps is a preview."
          checked={s.chatgptSignIn}
          onChange={(chatgptSignIn) => save.mutate({ chatgptSignIn })}
        />
        <SwitchField
          label="Persist secrets without a keyring"
          hint="Linux only: keeps secrets on disk when safeStorage falls back to basic_text. Anyone with your user account can read them."
          checked={s.persistWithoutKeyring}
          onChange={(persistWithoutKeyring) => save.mutate({ persistWithoutKeyring })}
        />
      </div>
      {save.error ? <p className="text-danger">{errorMessage(save.error)}</p> : null}

      <section aria-labelledby="doctor-h" className="rounded-md border border-line p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="doctor-h" className="label">
            Doctor
          </h3>
          <Button size="sm" onClick={() => doctor.mutate()} disabled={doctor.isPending}>
            <Stethoscope aria-hidden="true" />
            {doctor.isPending ? "Checking…" : "Run checks"}
          </Button>
        </div>
        {doctor.data ? (
          <ul className="grid gap-1">
            {doctor.data.map((c) => (
              <li key={c.name} className="grid grid-cols-[1rem_8rem_1fr] gap-2 font-mono text-xs">
                <span className={cn(c.ok ? "text-ok" : "text-amber")}>{c.ok ? "✓" : "!"}</span>
                <span>{c.name}</span>
                <span className="break-all text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Checks Node, keys, the browser, Codex and the runs folder.</p>
        )}
        {doctor.error ? <p className="text-danger">{errorMessage(doctor.error)}</p> : null}
      </section>
      {info.data ? (
        <p className="font-mono text-2xs text-faint">
          GhostHand {info.data.version} · Electron {info.data.electron} · {info.data.platform} · runs{" "}
          {info.data.runsDir}
        </p>
      ) : null}
    </div>
  );
}
