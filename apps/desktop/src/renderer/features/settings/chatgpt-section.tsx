// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Sign in with ChatGPT (plan usage preview). Follows OpenAI's SIWC UI guidelines: a "Continue with
// ChatGPT" button, a plan notice before first use, "Using ChatGPT plan" when active, and "Manage usage".
import type { ChatGptStatus } from "@ghosthand/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";
import { formatWhen } from "../../lib/format.ts";

const MANAGE_USAGE_URL =
  "https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites";

function ChatGptMark() {
  // Placeholder glyph. TODO: use the ChatGPT logo from OpenAI's SIWC brand assets once their terms are checked.
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12a4 4 0 0 1 8 0 4 4 0 0 1-8 0Z" />
    </svg>
  );
}

export function ChatGptSection() {
  const qc = useQueryClient();
  const pasteId = useId();
  const status = useQuery({ queryKey: ["chatgpt"], queryFn: () => call("chatgpt.status", {}) });
  const [acknowledged, setAcknowledged] = useState(false);
  const [pasted, setPasted] = useState("");
  const set = (s: ChatGptStatus) => qc.setQueryData(["chatgpt"], s);
  const signIn = useMutation({ mutationFn: () => call("chatgpt.signIn", {}), onSuccess: set });
  const signOut = useMutation({ mutationFn: () => call("chatgpt.signOut", {}), onSuccess: set });
  const cancel = useMutation({ mutationFn: () => call("chatgpt.cancel", {}), onSuccess: set });
  const manual = useMutation({
    mutationFn: () => call("chatgpt.completeManual", { url: pasted }),
    onSuccess: set,
  });
  const manage = () => void call("shell.openExternal", { url: MANAGE_USAGE_URL });
  const s = status.data;

  return (
    <section aria-labelledby="chatgpt-h" className="rounded-md border border-line p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 id="chatgpt-h" className="label">
          ChatGPT plan
        </h3>
        <Badge tone="amber">preview</Badge>
        {s?.signedIn ? <Badge tone="accent">Using ChatGPT plan</Badge> : null}
      </div>
      {!s?.enabled ? (
        <p className="text-muted">
          Sign in with ChatGPT is off. Turn on “ChatGPT plan (preview)” under Developer to use a Plus or Pro
          plan for planner and writer calls.
        </p>
      ) : s.signedIn ? (
        <div className="grid gap-3">
          <p>
            Planner, writer and judge calls to <span className="font-mono">openai/*</span> models use your
            ChatGPT plan instead of an API key. Jev still decides each step.
          </p>
          <p className="font-mono text-xs text-muted">
            token refresh {s.expiresAt ? formatWhen(s.expiresAt) : "–"} · {s.scopes.length} scopes
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={manage}>
              Manage usage
            </Button>
            <Button onClick={() => signOut.mutate()}>Sign out</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--accent)]"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              Eligible AI requests from GhostHand will use your ChatGPT plan (Plus or Pro) and count toward
              its usage limits. Plans exclude computer use and audio.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!acknowledged || s.pending || signIn.isPending}
              onClick={() => signIn.mutate()}
            >
              <ChatGptMark />
              Continue with ChatGPT
            </Button>
            {s.pending ? (
              <Button variant="ghost" onClick={() => cancel.mutate()}>
                Cancel sign-in
              </Button>
            ) : null}
            <Button variant="ghost" onClick={manage}>
              Manage usage
            </Button>
          </div>
          {s.pending ? (
            <div className="grid gap-2 rounded-[5px] border border-line bg-panel-2 p-3">
              <p className="text-muted">
                Finish signing in in your browser. If it cannot reach GhostHand, paste the address it ends on
                here.
              </p>
              <div className="flex items-end gap-2">
                <Field label="Redirect URL" htmlFor={pasteId} className="flex-1">
                  <Input
                    id={pasteId}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="http://127.0.0.1:1455/auth/callback?code=…"
                    className="font-mono"
                  />
                </Field>
                <Button disabled={pasted.length === 0} onClick={() => manual.mutate()}>
                  Finish sign-in
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {s?.error ? <p className="mt-2 text-danger">{s.error}</p> : null}
      {signIn.error ? <p className="mt-2 text-danger">{errorMessage(signIn.error)}</p> : null}
    </section>
  );
}
