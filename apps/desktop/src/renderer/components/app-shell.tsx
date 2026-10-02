// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Left rail navigation and the status strip. The strip always says which decision source and which
// plan a run would use, so the user never has to guess where requests (and costs) go.
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { History, PlayCircle, Radio, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { ApprovalDialog } from "../features/approvals/approval-dialog.tsx";
import { call } from "../lib/bridge.ts";
import { cn } from "../lib/cn.ts";
import { useLiveStore } from "../stores/live-store.ts";
import { Badge } from "./ui/badge.tsx";
import { Kbd } from "./ui/kbd.tsx";

function RailLink({
  to,
  icon,
  label,
  indicator,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  indicator?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col items-center gap-1 rounded-md px-1 py-2 text-muted hover:bg-panel-2 hover:text-ink data-[status=active]:bg-accent-soft data-[status=active]:text-accent"
    >
      <span className="[&_svg]:size-[18px]" aria-hidden="true">
        {icon}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider">{label}</span>
      {indicator ? (
        <>
          <span className="absolute top-1.5 right-2.5 size-1.5 rounded-full bg-amber" aria-hidden="true" />
          <span className="sr-only">(run active)</span>
        </>
      ) : null}
    </Link>
  );
}

function StatusStrip() {
  const engine = useLiveStore((s) => s.engine);
  const status = useLiveStore((s) => s.status);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const chatgpt = useQuery({ queryKey: ["chatgpt"], queryFn: () => call("chatgpt.status", {}) });
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: () => call("secrets.list", {}) });
  const hasJev = secrets.data?.names.includes("TYPESAFE_API_KEY") ?? false;
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
      <span className="flex items-center gap-2 font-mono text-[13px] font-semibold tracking-tight">
        <img
          src="/brand/ghosthand-32.png"
          srcSet="/brand/ghosthand-32.png 1x, /brand/ghosthand-64.png 2x"
          width={24}
          height={24}
          alt=""
          aria-hidden="true"
        />
        <span>
          ghost<span className="text-accent">hand</span>
        </span>
      </span>
      <span className="text-line-strong">/</span>
      <span className="flex items-center gap-1.5 font-mono text-2xs text-muted">
        <span
          className={cn(
            "size-1.5 rounded-full",
            engine === "ready" ? "bg-ok" : engine === "crashed" ? "bg-danger" : "bg-amber",
          )}
        />
        engine {engine === "unknown" ? "starting" : engine}
      </span>
      {status && status !== "ended" ? (
        <Badge tone={status === "paused" ? "amber" : "accent"}>run {status}</Badge>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {settings.data?.devPlumbingMode && !hasJev ? (
          <Badge tone="amber" title="No TypeSafe key: runs use the rule-based heuristic stand-in for Jev">
            plumbing mode
          </Badge>
        ) : (
          <Badge tone={hasJev ? "ok" : "neutral"}>{hasJev ? "jev ready" : "no jev key"}</Badge>
        )}
        {chatgpt.data?.enabled && chatgpt.data.signedIn ? (
          <Badge tone="accent">Using ChatGPT plan</Badge>
        ) : null}
        <span className="hidden items-center gap-1 text-2xs text-muted lg:flex">
          take over <Kbd>Ctrl</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>Space</Kbd>
        </span>
      </span>
    </div>
  );
}

export function AppShell() {
  const active = useLiveStore((s) => s.status !== undefined && s.status !== "ended");
  const approval = useLiveStore((s) => s.approval);
  return (
    <div className="flex h-full flex-col">
      <StatusStrip />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Main"
          className="flex w-[68px] shrink-0 flex-col gap-1 border-r border-line bg-panel p-1.5"
        >
          <RailLink to="/" icon={<PlayCircle />} label="Task" />
          <RailLink to="/live" icon={<Radio />} label="Live" indicator={active} />
          <RailLink to="/runs" icon={<History />} label="Runs" />
          <span className="flex-1" />
          <RailLink to="/settings" icon={<Settings2 />} label="Setup" />
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <ApprovalDialog request={approval} />
    </div>
  );
}
