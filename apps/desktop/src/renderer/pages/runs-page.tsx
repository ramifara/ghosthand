// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Run history from the SQLite run index (shared with the CLI).
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { ReuseTaskButton } from "../components/reuse-task-button.tsx";
import { Badge, type BadgeTone } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Empty, Panel } from "../components/ui/panel.tsx";
import { call, errorMessage } from "../lib/bridge.ts";
import { formatMs, formatUsd, formatWhen } from "../lib/format.ts";

const TONE: Record<string, BadgeTone> = {
  success: "ok",
  failure: "danger",
  error: "danger",
  stuck: "amber",
  budget_exhausted: "amber",
  aborted: "neutral",
};

export function RunsPage({
  onOpen,
  onTaskReady,
}: {
  onOpen: (runId: string) => void;
  onTaskReady: () => void;
}) {
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => call("runs.list", { limit: 200 }) });
  return (
    <div className="h-full p-3">
      <Panel
        title={`Runs${runs.data ? ` · ${runs.data.length}` : ""}`}
        className="h-full"
        bodyClassName="overflow-auto"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void runs.refetch()} aria-label="Refresh runs">
            <RefreshCw aria-hidden="true" />
          </Button>
        }
      >
        {runs.isError ? (
          <p className="p-4 text-danger">{errorMessage(runs.error)}</p>
        ) : runs.data && runs.data.length === 0 ? (
          <Empty title="No runs recorded">Runs from this app and from the ghosthand CLI appear here.</Empty>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line">
                {[
                  "Started",
                  "Task",
                  "Outcome",
                  "Steps",
                  "Wall",
                  "Cost",
                  "Jev / model calls",
                  "Decision",
                  "Reuse",
                ].map((h) => (
                  <th key={h} scope="col" className="label px-3 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(runs.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-line hover:bg-panel-2">
                  <td className="num px-3 py-1.5 text-xs whitespace-nowrap">
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline"
                      onClick={() => onOpen(r.id)}
                      aria-label={`Open run ${r.id}`}
                    >
                      {formatWhen(r.startedAt)}
                    </button>
                  </td>
                  <td className="max-w-[28rem] px-3 py-1.5">
                    <span className="font-mono text-xs text-muted">{r.taskId ?? "adhoc"}</span>{" "}
                    <span className="truncate">{r.instruction}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    {r.outcome ? (
                      <Badge tone={TONE[r.outcome] ?? "neutral"}>{r.outcome.replace("_", " ")}</Badge>
                    ) : (
                      <Badge>open</Badge>
                    )}
                  </td>
                  <td className="num px-3 py-1.5 text-xs">{r.steps}</td>
                  <td className="num px-3 py-1.5 text-xs">{formatMs(r.wallMs)}</td>
                  <td className="num px-3 py-1.5 text-xs">{formatUsd(r.costUsd)}</td>
                  <td className="num px-3 py-1.5 text-xs">
                    {r.decisionCalls} / {r.modelCalls}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted">{r.decisionModel}</td>
                  <td className="px-3 py-1.5">
                    <ReuseTaskButton runId={r.id} onReady={onTaskReady} label="Use task" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
