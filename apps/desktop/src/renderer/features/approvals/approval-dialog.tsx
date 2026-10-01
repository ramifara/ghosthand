// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A consequential ("commit") action the task did not pre-approve. The run waits until the user answers;
// the dialog cannot be dismissed without choosing.
import type { ApprovalDecision, ApprovalRequestView } from "@ghosthand/protocol";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent } from "../../components/ui/dialog.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";

export function ApprovalDialog({ request }: { request: ApprovalRequestView | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const answer = async (decision: ApprovalDecision) => {
    if (!request) return;
    setBusy(true);
    setError(undefined);
    try {
      await call("runs.approve", { requestId: request.requestId, decision });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={request !== undefined}>
      {request ? (
        <DialogContent
          dismissible={false}
          title={
            <span className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-amber" aria-hidden="true" />
              Allow this action?
            </span>
          }
          description="The agent wants to do something with consequences that this task did not pre-approve."
        >
          <div className="grid gap-3 px-5 py-4">
            <div className="rounded-[5px] border border-line bg-panel-2 p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge tone="amber">{request.effect}</Badge>
                <span className="label">step {request.step}</span>
              </div>
              <p className="font-mono text-[13px]">{request.describe}</p>
              {request.target?.context ? (
                <p className="mt-1 text-xs text-muted">near: {request.target.context}</p>
              ) : null}
            </div>
            <p className="text-muted">
              <span className="label mr-1.5">goal</span>
              {request.goal}
            </p>
            {error ? <p className="text-danger">{error}</p> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
            <Button variant="danger" onClick={() => void answer("deny")} disabled={busy}>
              Deny
            </Button>
            <Button onClick={() => void answer("task")} disabled={busy}>
              Allow for this task
            </Button>
            <Button variant="primary" onClick={() => void answer("once")} disabled={busy} autoFocus>
              Allow once
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
