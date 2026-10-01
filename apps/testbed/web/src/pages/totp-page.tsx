// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 two-step verification: the TOTP code after a correct password (the challenge lives in a cookie).
import { AUTH_MESSAGES, safeNextPath } from "@ghosthand/testbed-kit/auth";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthCard, BackToSignIn } from "../components/auth-card.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { authApi } from "../lib/auth-api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

export function TotpPage() {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);
    const res = await authApi.verifyTotp(code);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      setCode("");
      return;
    }
    setUser(res.value.user);
    void navigate(safeNextPath(params.get("next")) ?? "/");
  }

  return (
    <AuthCard title="Two-step verification" description={AUTH_MESSAGES.totpPrompt}>
      <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} noValidate {...tid("totp.form")}>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="space-y-1">
          <Label htmlFor="totp-code">Authentication code</Label>
          <Input
            id="totp-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            {...tid("totp.code")}
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={pending || code.trim() === ""}
          {...tid("totp.submit")}
        >
          {pending ? "Verifying…" : "Verify"}
        </Button>
      </form>
      <BackToSignIn />
    </AuthCard>
  );
}
