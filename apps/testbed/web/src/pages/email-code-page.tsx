// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 email code: ask for a 6-digit code, then enter it. The pending sign-in is a cookie, so the page shows the
// code step again after a trip to the mailbox; the mail's "Use code" link fills the code in via `?code=`.
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthCard, BackToSignIn, MailboxLink } from "../components/auth-card.tsx";
import { EmailRequestForm } from "../components/email-request-form.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { authApi } from "../lib/auth-api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

export function EmailCodePage() {
  const [params] = useSearchParams();
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    void authApi.pendingEmailCode().then((res) => setPending(res.ok ? res.value.email : null));
  }, []);

  return (
    <AuthCard title="Sign in with an email code" description="We'll email you a 6-digit code.">
      {pending === undefined ? <p className="text-muted">Loading…</p> : null}
      {pending === null ? (
        <EmailRequestForm
          id="email-code"
          submitLabel="Email me a code"
          send={authApi.requestEmailCode}
          onSent={(email, message) => {
            setNotice(message);
            setPending(email);
          }}
        />
      ) : null}
      {pending ? (
        <CodeForm
          email={pending}
          initialCode={params.get("code") ?? ""}
          notice={notice}
          onRestart={() => {
            setNotice(undefined);
            setPending(null);
          }}
        />
      ) : null}
      <BackToSignIn />
    </AuthCard>
  );
}

function CodeForm({
  email,
  initialCode,
  notice,
  onRestart,
}: {
  email: string;
  initialCode: string;
  notice: string | undefined;
  onRestart: () => void;
}) {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    const res = await authApi.verifyEmailCode(code.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setUser(res.value.user);
    void navigate("/");
  }

  return (
    <>
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      <p className="text-sm">
        {"Enter the 6-digit code we sent to "}
        <strong className="font-mono">{email}</strong>.
      </p>
      <MailboxLink address={email} />
      <form
        className="space-y-3"
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        {...tid("email-code.verify-form")}
      >
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="space-y-1">
          <Label htmlFor="email-code-code">6-digit code</Label>
          <Input
            id="email-code-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            {...tid("email-code.code")}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy} {...tid("email-code.verify")}>
          {busy ? "Verifying…" : "Verify code"}
        </Button>
      </form>
      <p className="text-xs">
        <button type="button" className="text-accent underline" onClick={onRestart}>
          Use a different email
        </button>
      </p>
    </>
  );
}
