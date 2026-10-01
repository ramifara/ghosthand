// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// "Enter your email, we'll mail you something" form shared by the magic link, email code and reset pages.
import { type FormEvent, useState } from "react";
import type { CallResult } from "../lib/auth-api.ts";
import { tid } from "../lib/tid.ts";
import { Alert } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";

export function EmailRequestForm({
  id,
  submitLabel,
  send,
  onSent,
}: {
  /** Prefix for element ids and test ids, e.g. "magic". */
  id: string;
  submitLabel: string;
  send: (email: string) => Promise<CallResult<{ message: string }>>;
  onSent: (email: string, message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const address = email.trim().toLowerCase();
    if (!address) {
      setError("Enter your email address.");
      return;
    }
    setPending(true);
    const res = await send(address);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onSent(address, res.value.message);
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} noValidate {...tid(`${id}.form`)}>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="space-y-1">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...tid(`${id}.email`)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending} {...tid(`${id}.submit`)}>
        {pending ? "Sending…" : submitLabel}
      </Button>
    </form>
  );
}
