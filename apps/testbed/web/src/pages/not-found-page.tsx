// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted">
        There is nothing at this address.{" "}
        <Link to="/" className="text-accent underline">
          Go home
        </Link>
      </p>
    </div>
  );
}
