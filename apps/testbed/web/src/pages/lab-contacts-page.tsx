// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 file upload and download: import contacts from a CSV picked with a labelled <input type="file">,
// then download the list as CSV (a plain link with `download`, served as an attachment and audited).
import type { ContactRow } from "@ghosthand/testbed-kit/lab";
import { Download } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

export function LabContactsPage() {
  return (
    <LabPage
      title="Contacts"
      description="Import contacts from a CSV file (columns: name, email, company) or download the list."
      what="manage contacts"
    >
      {() => <Contacts />}
    </LabPage>
  );
}

function Contacts() {
  const [contacts, setContacts] = useState<ContactRow[] | undefined>(undefined);
  const [status, setStatus] = useState<LabStatus>(undefined);
  const [pending, setPending] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void labApi.contacts().then((res) => {
      if (res.ok) setContacts(res.value.contacts);
      else setStatus({ ok: false, text: res.message });
    });
  }, []);

  async function onImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen) return setStatus({ ok: false, text: "Choose a CSV file first." });
    setPending(true);
    const res = await labApi.importContacts(chosen.name, await chosen.text());
    setPending(false);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setContacts(res.value.contacts);
    setStatus({ ok: true, text: res.value.message });
    if (file.current) file.current.value = "";
  }

  return (
    <div className="space-y-4">
      <form
        aria-label="Import contacts"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-panel p-3"
        onSubmit={(e) => void onImport(e)}
        {...tid("contacts.import-form")}
      >
        <div className="space-y-1">
          <Label htmlFor="contacts-file">Contacts CSV file</Label>
          <input
            ref={file}
            id="contacts-file"
            type="file"
            accept=".csv,text/csv"
            className="block text-sm file:mr-2 file:rounded-md file:border file:border-border file:bg-panel file:px-2 file:py-1"
            {...tid("contacts.file")}
          />
        </div>
        <Button type="submit" disabled={pending} {...tid("contacts.import")}>
          {pending ? "Importing…" : "Import"}
        </Button>
        {/* The result shows next to the form that caused it. */}
        <div className="basis-full empty:hidden">
          <LabStatusLine status={status} />
        </div>
      </form>
      <section
        aria-label="Download contacts"
        className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3"
      >
        <p className="flex-1 text-sm text-muted">Download every contact in the list as a CSV file.</p>
        <Button asChild variant="outline">
          <a href="/api/lab/contacts/export.csv" download="contacts-export.csv" {...tid("contacts.download")}>
            <Download aria-hidden="true" className="size-4" />
            Download CSV
          </a>
        </Button>
      </section>
      <table aria-label="Contacts" className="w-full text-left text-sm" {...tid("contacts.table")}>
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="py-1.5">Name</th>
            <th>Email</th>
            <th>Company</th>
          </tr>
        </thead>
        <tbody>
          {(contacts ?? []).map((c) => (
            <tr key={c.id} className="border-b border-border/60">
              <td className="py-1.5">{c.name}</td>
              <td className="font-mono text-xs">{c.email}</td>
              <td>{c.company}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">{contacts ? `${contacts.length} contacts` : "Loading…"}</p>
    </div>
  );
}
