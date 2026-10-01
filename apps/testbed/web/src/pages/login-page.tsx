// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { api } from "../lib/api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

export function LoginPage() {
  const { setUser } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    const res = await api.login(email, password);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      setPassword("");
      return;
    }
    setUser(res.value.user);
    void navigate("/");
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
      </CardContent>
    </Card>
  );
}
