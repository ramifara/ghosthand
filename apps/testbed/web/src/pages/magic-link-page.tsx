// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 magic link, step 2: the link from the mail. A "Continue" press is required (link scanners can't sign in).
import { AUTH_MESSAGES } from "@ghosthand/testbed-kit/auth";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthCard, BackToSignIn } from "../components/auth-card.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { authApi } from "../lib/auth-api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

export function MagicLinkPage() {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setEmail(null);
      return;
    }
    void authApi.peekMagicLink(token).then((res) => setEmail(res.ok ? res.value.email : null));
  }, [token]);

  async function onContinue() {
    setError(undefined);
    setPending(true);
    const res = await authApi.consumeMagicLink(token);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setUser(res.value.user);
    void navigate("/");
  }

  return (
    <AuthCard title="Sign in with an email link">
      {email === undefined ? <p className="text-muted">Checking your link…</p> : null}
      {email === null ? <Alert variant="destructive">{AUTH_MESSAGES.linkInvalid}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {email ? (
        <>
          <p className="text-sm">
            {"Continue to sign in as "}
            <strong className="font-mono">{email}</strong>.
          </p>
          <Button
            className="w-full"
            disabled={pending}
            onClick={() => void onContinue()}
            {...tid("magic.continue")}
          >
            {pending ? "Signing in…" : "Continue"}
          </Button>
        </>
      ) : null}
      <BackToSignIn />
    </AuthCard>
  );
}
