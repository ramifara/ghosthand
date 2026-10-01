// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Frame for the L4 lab pages: a heading, a short description and a polite status line.
import type { ReactNode } from "react";
import { RequireSession } from "./require-session.tsx";
import { Alert } from "./ui/alert.tsx";

export type LabStatus = { ok: boolean; text: string } | undefined;

export function LabPage({
  title,
  description,
  what,
  children,
}: {
  title: string;
  description: string;
  what: string;
  children: () => ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <RequireSession what={what}>{() => children()}</RequireSession>
    </div>
  );
}

export function LabStatusLine({ status }: { status: LabStatus }) {
  if (!status) return null;
  return <Alert variant={status.ok ? "success" : "destructive"}>{status.text}</Alert>;
}
