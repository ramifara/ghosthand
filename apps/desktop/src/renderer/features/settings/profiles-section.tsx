// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Persistent browser profiles (one per project or account) and Chrome profile import.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";
import { formatBytes } from "../../lib/format.ts";

export function ProfilesSection() {
  const qc = useQueryClient();
  const nameId = useId();
  const importNameId = useId();
  const chromeId = useId();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => call("profiles.list", {}) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const [name, setName] = useState("");
  const [importName, setImportName] = useState("");
  const [chromeProfile, setChromeProfile] = useState("Default");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["profiles"] });
  const create = useMutation({
    mutationFn: () => call("profiles.create", { name }),
    onSuccess: () => {
      setName("");
      refresh();
    },
  });
  const imp = useMutation({
    mutationFn: () => call("profiles.import", { name: importName, chromeProfile }),
    onSuccess: refresh,
  });
  const makeDefault = useMutation({
    mutationFn: (defaultProfile: string) => call("settings.set", { defaultProfile }),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
  const valid = (n: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n);
  return (
    <div className="grid max-w-3xl gap-6">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line">
            {["Profile", "Size", "Last used", ""].map((h) => (
              <th key={h} className="label px-2 py-1.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(profiles.data ?? []).map((p) => (
            <tr key={p.name} className="border-b border-line">
              <td className="px-2 py-1.5 font-mono text-xs">
                {p.name}{" "}
                {settings.data?.defaultProfile === p.name ? <Badge tone="accent">default</Badge> : null}
                {p.importedFrom ? <Badge>imported</Badge> : null}
              </td>
              <td className="num px-2 py-1.5 text-xs">{formatBytes(p.sizeBytes)}</td>
              <td className="num px-2 py-1.5 text-xs text-muted">
                {p.lastUsedAt?.slice(0, 16).replace("T", " ") ?? "never"}
              </td>
              <td className="px-2 py-1.5 text-right">
                {settings.data?.defaultProfile !== p.name ? (
                  <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(p.name)}>
                    Make default
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
          {profiles.data?.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-2 py-3 text-muted">
                No profiles yet. The first run creates “{settings.data?.defaultProfile ?? "default"}”.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex items-end gap-2">
        <Field label="New profile" htmlFor={nameId} className="w-64">
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            placeholder="acme-staging"
            className="font-mono"
          />
        </Field>
        <Button disabled={!valid(name) || create.isPending} onClick={() => create.mutate()}>
          Create profile
        </Button>
        {create.error ? <span className="mb-2 text-danger">{errorMessage(create.error)}</span> : null}
      </div>

      <section aria-labelledby="import-h" className="rounded-md border border-line p-4">
        <h3 id="import-h" className="label mb-1">
          Import from Chrome
        </h3>
        <p className="mb-3 text-muted">
          Copies a Chrome profile (cookies, logins) into a new GhostHand profile. Close Chrome first; the copy
          only works for this user on this machine.
        </p>
        <div className="flex items-end gap-2">
          <Field label="Chrome profile folder" htmlFor={chromeId} className="w-48">
            <Input
              id={chromeId}
              value={chromeProfile}
              onChange={(e) => setChromeProfile(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label="New name" htmlFor={importNameId} className="w-48">
            <Input
              id={importNameId}
              value={importName}
              onChange={(e) => setImportName(e.target.value.toLowerCase())}
              className="font-mono"
            />
          </Field>
          <Button disabled={!valid(importName) || imp.isPending} onClick={() => imp.mutate()}>
            {imp.isPending ? "Importing…" : "Import"}
          </Button>
        </div>
        {imp.error ? <p className="mt-2 text-danger">{errorMessage(imp.error)}</p> : null}
        {imp.isSuccess ? <p className="mt-2 text-ok">Imported “{imp.data.name}”.</p> : null}
      </section>
    </div>
  );
}
