// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L0: static text, a value to read, a link.
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert } from "../components/ui/alert.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { api, type Home } from "../lib/api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

export function HomePage() {
  const { user } = useSession();
  const [home, setHome] = useState<Home | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void api.home().then((res) => (res.ok ? setHome(res.value) : setError(res.message)));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Welcome to the testbed</h1>
        <p className="mt-1 max-w-prose text-muted">
          This is a small, deterministic app for testing GhostHand. Everything here is fixture data and resets
          between runs.
        </p>
      </div>

      <Card aria-labelledby="build-title">
        <CardHeader>
          <CardTitle id="build-title">Current build</CardTitle>
          <CardDescription>Seeded values. They change only when the seed changes.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {home ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted">Build code</dt>
              <dd className="font-mono" {...tid("home.build-code")}>
                {home.buildCode}
              </dd>
              <dt className="text-muted">Release</dt>
              <dd {...tid("home.release")}>{home.releaseName}</dd>
              <dt className="text-muted">Open tickets</dt>
              <dd className="font-mono" {...tid("home.open-tickets")}>
                {home.openTickets}
              </dd>
            </dl>
          ) : error ? null : (
            <p className="text-muted" aria-live="polite">
              Loading…
            </p>
          )}
        </CardContent>
      </Card>

      <p>
        <Link
          to={user ? "/profile" : "/login"}
          className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
          {...tid("home.cta")}
        >
          {user ? "Edit your profile" : "Sign in to your account"}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </p>
    </div>
  );
}
