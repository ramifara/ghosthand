// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 status message. Under the `session-expiry` seed the first save finds the session expired; the page then
// asks the user to sign in again (and comes back here afterwards).
import { AUTH_MESSAGES, STATUS_MAX } from "@ghosthand/testbed-kit/auth";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { authApi } from "../lib/auth-api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

const SIGN_IN_AGAIN = `/login?next=${encodeURIComponent("/status?resumed=1")}`;
const RESUMED_NOTICE = "You're signed in again. Your status wasn't saved yet: enter it and save it again.";

export function StatusPage() {
  const { user, setUser } = useSession();
  const [params] = useSearchParams();
  const resumed = params.get("resumed") === "1";
  const [current, setCurrent] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user) return;
    void authApi.status().then((res) => {
      if (res.ok) setCurrent(res.value.message);
    });
  }, [user]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(undefined);
    setError(undefined);
    setPending(true);
    const res = await authApi.saveStatus(draft);
    setPending(false);
    if (!res.ok) {
      if (res.status === 401) {
        setExpired(true);
        setUser(null);
      }
      setError(res.message);
      return;
    }
    setCurrent(res.value.message);
    setSaved(res.value.notice);
  }

  if (user === undefined) return <p className="text-muted">Loading…</p>;
  if (user === null) {
    return (
      <Alert variant={expired ? "destructive" : "info"} role="alert">
        {expired ? AUTH_MESSAGES.sessionExpired : "You need to sign in to set your status."}{" "}
        <Link to={SIGN_IN_AGAIN} className="text-accent underline" {...tid("status.signin")}>
          {expired ? "Sign in again" : "Sign in"}
        </Link>
      </Alert>
    );
  }

  return (
    <Card className="max-w-lg" aria-labelledby="status-title">
      <CardHeader>
        <CardTitle as="h1" id="status-title" className="text-base">
          Your status
        </CardTitle>
        <CardDescription>Let your team know what you're working on.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} noValidate {...tid("status.form")}>
          {resumed && !saved ? <Alert variant="info">{RESUMED_NOTICE}</Alert> : null}
          {saved ? <Alert variant="success">{saved}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <p className="text-sm">
            {"Current status: "}
            <span className="font-medium" {...tid("status.current")}>
              {current === undefined ? "…" : current || "(none)"}
            </span>
          </p>
          <div className="space-y-1">
            <Label htmlFor="status-message">Status message</Label>
            <Input
              id="status-message"
              maxLength={STATUS_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              {...tid("status.message")}
            />
          </div>
          <Button type="submit" disabled={pending} {...tid("status.save")}>
            {pending ? "Saving…" : "Save status"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
