// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 password reset, step 2: the link from the mail; choose a new password, then sign in with it.
import { AUTH_MESSAGES } from "@ghosthand/testbed-kit/auth";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthCard, BackToSignIn } from "../components/auth-card.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { authApi } from "../lib/auth-api.ts";
import { tid } from "../lib/tid.ts";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setEmail(null);
      return;
    }
    void authApi.peekReset(token).then((res) => setEmail(res.ok ? res.value.email : null));
  }, [token]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (password.length < 8 || password !== confirm) {
      setError(AUTH_MESSAGES.resetMismatch);
      return;
    }
    setPending(true);
    const res = await authApi.completeReset(token, password, confirm);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    void navigate("/login?reset=done");
  }

  return (
    <AuthCard title="Choose a new password">
      {email === undefined ? <p className="text-muted">Checking your link…</p> : null}
      {email === null ? <Alert variant="destructive">{AUTH_MESSAGES.resetInvalid}</Alert> : null}
      {email ? (
        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} noValidate {...tid("reset.form")}>
          <p className="text-sm">
            {"For "}
            <strong className="font-mono">{email}</strong>
          </p>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...tid("reset.password")}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reset-confirm">Confirm new password</Label>
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              {...tid("reset.confirm")}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending} {...tid("reset.submit")}>
            {pending ? "Saving…" : "Set new password"}
          </Button>
        </form>
      ) : null}
      <BackToSignIn />
    </AuthCard>
  );
}
