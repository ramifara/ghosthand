// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { safeNextPath } from "@ghosthand/testbed-kit/auth";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { LoginAlternatives, LoginNotices } from "../components/login-alternatives.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { authApi } from "../lib/auth-api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

export function LoginPage() {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    const res = await authApi.login(email, password);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      setPassword("");
      return;
    }
    // L5: TOTP users continue on the two-step page.
    if ("mfa" in res.value) {
      void navigate(`/login/totp${next ? `?next=${encodeURIComponent(next)}` : ""}`);
      return;
    }
    setUser(res.value.user);
    void navigate(next ?? "/");
  }

  return (
    <Card className="mx-auto max-w-sm" aria-labelledby="login-title">
      <CardHeader>
        <CardTitle as="h1" id="login-title" className="text-base">
          Sign in
        </CardTitle>
        <CardDescription>Use your testbed account.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginNotices params={params} />
        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} noValidate {...tid("login.form")}>
          {error ? (
            <Alert variant="destructive" {...tid("login.error")}>
              {error}
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...tid("login.email")}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...tid("login.password")}
            />
          </div>
          <Button type="submit" className="w-full" disabled={pending} {...tid("login.submit")}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <LoginAlternatives />
      </CardContent>
    </Card>
  );
}
