// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Provider keys and site secrets. Values go to main once and are never read back: the renderer only sees
// names and whether the keyring can persist them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";
import { ChatGptSection } from "./chatgpt-section.tsx";

const PROVIDER_KEYS = [
  {
    name: "TYPESAFE_API_KEY",
    label: "TypeSafe (Jev)",
    hint: "Decides every step. Required unless plumbing mode is on.",
  },
  {
    name: "OPENAI_API_KEY",
    label: "OpenAI API key",
    hint: "Planner, writer and judges through the models layer.",
  },
] as const;

function SecretRow({
  name,
  label,
  hint,
  isSet,
}: {
  name: string;
  label: string;
  hint: string;
  isSet: boolean;
}) {
  const id = useId();
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: () => call("secrets.set", { name, value }),
    onSuccess: (status) => {
      setValue("");
      qc.setQueryData(["secrets"], status);
      void qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => call("secrets.delete", { name }),
    onSuccess: (status) => qc.setQueryData(["secrets"], status),
  });
  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-2 border-b border-line py-3 last:border-b-0">
      <Field
        label={label}
        htmlFor={id}
        hint={
          <>
            {hint} <span className="font-mono">{name}</span>
            {save.error ? <span className="text-danger"> · {errorMessage(save.error)}</span> : null}
          </>
        }
      >
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={isSet ? "•••••••• stored (enter a new value to replace)" : "Paste the key"}
          onChange={(e) => setValue(e.target.value)}
          className="font-mono"
        />
      </Field>
      <div className="mb-5 flex gap-1.5">
        <Button
          variant="primary"
          disabled={value.length === 0 || save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!isSet}
          onClick={() => remove.mutate()}
          aria-label={`Delete ${label}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function ProvidersSection() {
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: () => call("secrets.list", {}) });
  const [customName, setCustomName] = useState("");
  const customId = useId();
  const names = secrets.data?.names ?? [];
  const custom = names.filter((n) => !PROVIDER_KEYS.some((k) => k.name === n));
  const validCustom = /^[A-Z][A-Z0-9_]{0,63}$/.test(customName);
  return (
    <div className="grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-muted" aria-hidden="true" />
        <span className="label">secret storage</span>
        <Badge tone={secrets.data?.persistent ? "ok" : "amber"}>{secrets.data?.backend ?? "…"}</Badge>
        <Badge tone={secrets.data?.persistent ? "ok" : "amber"}>
          {secrets.data?.persistent ? "encrypted on disk" : "memory only"}
        </Badge>
      </div>
      {secrets.data?.warning ? (
        <p role="alert" className="rounded-[5px] border border-amber/40 bg-amber-soft px-3 py-2 text-amber">
          {secrets.data.warning}
        </p>
      ) : null}

      <section aria-labelledby="keys-h">
        <h3 id="keys-h" className="label mb-1">
          Provider keys
        </h3>
        {PROVIDER_KEYS.map((k) => (
          <SecretRow
            key={k.name}
            name={k.name}
            label={k.label}
            hint={k.hint}
            isSet={names.includes(k.name)}
          />
        ))}
      </section>

      <ChatGptSection />

      <section aria-labelledby="site-h">
        <h3 id="site-h" className="label mb-1">
          Site secrets
        </h3>
        <p className="mb-2 text-muted">
          Passwords and TOTP seeds the agent may type. Models only ever see{" "}
          <span className="font-mono">[input:NAME]</span>.
        </p>
        {custom.map((n) => (
          <SecretRow key={n} name={n} label={n} hint="Typed by the driver at action time." isSet />
        ))}
        <div className="flex items-end gap-2 pt-2">
          <Field label="New secret name" htmlFor={customId} className="w-72">
            <Input
              id={customId}
              value={customName}
              onChange={(e) => setCustomName(e.target.value.toUpperCase())}
              placeholder="ACME_PASSWORD"
              className="font-mono"
            />
          </Field>
          {validCustom && !names.includes(customName) ? (
            <SecretRow name={customName} label={`Value for ${customName}`} hint="" isSet={false} />
          ) : null}
        </div>
      </section>
    </div>
  );
}
