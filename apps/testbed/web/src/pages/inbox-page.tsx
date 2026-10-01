// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// In-app mailbox: the fallback when Mailpit isn't running. Shows mail for the signed-in user.
import { Mail as MailIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert } from "../components/ui/alert.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { api, type Mail } from "../lib/api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

export function InboxPage() {
  const { user } = useSession();
  const [messages, setMessages] = useState<Mail[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    void api.mail().then((res) => (res.ok ? setMessages(res.value.messages) : setError(res.message)));
  }, [user]);

  if (user === undefined) return <p className="text-muted">Loading…</p>;
  if (user === null) {
    return (
      <Alert variant="info" role="alert">
        You need to sign in to read your mail.{" "}
        <Link to="/login" className="text-accent underline">
          Sign in
        </Link>
      </Alert>
    );
  }

  return (
    <Card aria-labelledby="inbox-title">
      <CardHeader>
        <CardTitle as="h1" id="inbox-title" className="text-base">
          Inbox
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {messages === undefined && !error ? <p className="text-muted">Loading…</p> : null}
        {messages?.length === 0 ? <p className="text-muted">No messages yet.</p> : null}
        {messages && messages.length > 0 ? (
          <ul className="divide-y divide-border" aria-label="Messages" {...tid("inbox.list")}>
            {messages.map((m) => (
              <li key={m.id} className="py-2" {...tid(`inbox.message.${m.id}`)}>
                <article aria-labelledby={`mail-${m.id}`}>
                  <div className="flex items-baseline gap-2">
                    <MailIcon aria-hidden="true" className="size-3.5 self-center text-accent" />
                    <h2 id={`mail-${m.id}`} className="text-sm font-medium">
                      {m.subject}
                    </h2>
                    <span className="ml-auto font-mono text-xs text-muted">{m.at}</span>
                  </div>
                  <p className="text-xs text-muted">From {m.from}</p>
                  <p className="mt-1 text-sm">{m.body}</p>
                </article>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
