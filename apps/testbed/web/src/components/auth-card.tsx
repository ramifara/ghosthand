// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The narrow card the sign-in pages share, plus the link to the dev mailbox the L5 flows send mail to.
import { Inbox } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Link } from "react-router";
import { tid } from "../lib/tid.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx";

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card className="mx-auto max-w-sm" aria-labelledby={id}>
      <CardHeader>
        <CardTitle as="h1" id={id} className="text-base">
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export function MailboxLink({ address }: { address: string }) {
  return (
    <Link
      to={`/mailbox?address=${encodeURIComponent(address)}`}
      className="inline-flex items-center gap-1.5 text-sm text-accent underline"
      {...tid("auth.mailbox")}
    >
      <Inbox aria-hidden="true" className="size-3.5" />
      Open the testbed mailbox
    </Link>
  );
}

export function BackToSignIn() {
  return (
    <p className="text-xs">
      <Link to="/login" className="text-accent underline">
        Back to sign in
      </Link>
    </p>
  );
}
