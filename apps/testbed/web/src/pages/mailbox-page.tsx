// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The testbed's dev mailbox (a stand-in for Mailpit): every mail the testbed sent to an address, newest first,
// readable without a session so sign-in links and codes can be read before signing in. Mail bodies are plain
// text where `[label](/path)` becomes a link; only same-origin paths are linked.
import { Mail as MailIcon } from "lucide-react";
import { type FormEvent, Fragment, type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import type { Mail } from "../lib/api.ts";
import { authApi } from "../lib/auth-api.ts";
import { tid } from "../lib/tid.ts";

const LINK = /\[([^\]\n]+)\]\((\/[^)\s]*)\)/g;

function renderMailBody(body: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`t${last}`}>{body.slice(last, at)}</Fragment>);
    out.push(
      <Link key={`l${at}`} to={m[2] ?? "/"} className="font-medium text-accent underline">
        {m[1]}
      </Link>,
    );
    last = at + m[0].length;
  }
  if (last < body.length) out.push(<Fragment key={`t${last}`}>{body.slice(last)}</Fragment>);
  return out;
}

export function MailboxPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const address = (params.get("address") ?? "").trim().toLowerCase();
  const [draft, setDraft] = useState(address);
  const [messages, setMessages] = useState<Mail[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setDraft(address);
    setMessages(undefined);
    setError(undefined);
    if (!address) return;
    void authApi
      .mailbox(address)
      .then((res) => (res.ok ? setMessages([...res.value.messages].reverse()) : setError(res.message)));
  }, [address]);

  function onOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void navigate(`/mailbox?address=${encodeURIComponent(draft.trim().toLowerCase())}`);
  }

  return (
    <Card aria-labelledby="mailbox-title">
      <CardHeader>
        <CardTitle as="h1" id="mailbox-title" className="text-base">
          Testbed mailbox
        </CardTitle>
        <CardDescription>Every email the testbed sends, by address. No sign-in needed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="flex items-end gap-2" onSubmit={onOpen} {...tid("mailbox.form")}>
          <div className="flex-1 space-y-1">
            <Label htmlFor="mailbox-address">Mailbox address</Label>
            <Input
              id="mailbox-address"
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              {...tid("mailbox.address")}
            />
          </div>
          <Button type="submit" variant="outline">
            Open mailbox
          </Button>
        </form>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {address && messages === undefined && !error ? <p className="text-muted">Loading…</p> : null}
        {messages?.length === 0 ? <p className="text-muted">{`No messages for ${address} yet.`}</p> : null}
        {messages && messages.length > 0 ? (
          <ul
            className="divide-y divide-border"
            aria-label={`Messages for ${address}`}
            {...tid("mailbox.list")}
          >
            {messages.map((m) => (
              <li key={m.id} className="py-2" {...tid(`mailbox.message.${m.id}`)}>
                <article aria-labelledby={`mailbox-${m.id}`}>
                  <div className="flex items-baseline gap-2">
                    <MailIcon aria-hidden="true" className="size-3.5 self-center text-accent" />
                    <h2 id={`mailbox-${m.id}`} className="text-sm font-medium">
                      {m.subject}
                    </h2>
                    <span className="ml-auto font-mono text-xs text-muted">{m.at}</span>
                  </div>
                  <p className="text-xs text-muted">{`From ${m.from} to ${m.to}`}</p>
                  <p className="mt-1 text-sm">{renderMailBody(m.body)}</p>
                </article>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
