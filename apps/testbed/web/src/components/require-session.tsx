// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Renders its children only for a signed-in user; otherwise a sign-in prompt.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { User } from "../lib/api.ts";
import { useSession } from "../lib/session-context.tsx";
import { Alert } from "./ui/alert.tsx";

export function RequireSession({ what, children }: { what: string; children: (user: User) => ReactNode }) {
  const { user } = useSession();
  if (user === undefined) return <p className="text-muted">Loading…</p>;
  if (user === null) {
    return (
      <Alert variant="info" role="alert">
        {`You need to sign in to ${what}.`}{" "}
        <Link to="/login" className="text-accent underline">
          Sign in
        </Link>
      </Alert>
    );
  }
  return children(user);
}
