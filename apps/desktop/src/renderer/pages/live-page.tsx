// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Live view: the agent's browser (screencast + target reticle) beside the step tape, with take over /
// resume and stop. Ctrl+Shift+Space toggles takeover here and, during a run, system-wide.
import { Hand, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ReuseTaskButton } from "../components/reuse-task-button.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Kbd } from "../components/ui/kbd.tsx";
import { Empty, Panel } from "../components/ui/panel.tsx";
import { ScreencastView } from "../features/live/screencast-view.tsx";
import { deriveRun } from "../features/timeline/derive-steps.ts";
import { StepTimeline, TimingLegend } from "../features/timeline/step-timeline.tsx";
import { call, errorMessage } from "../lib/bridge.ts";
import { toggleTakeover } from "../lib/engine-stream.ts";
import { formatMs, formatUsd } from "../lib/format.ts";
import { useLiveStore } from "../stores/live-store.ts";

const OUTCOME_TONE = {
  success: "ok",
  failure: "danger",
  error: "danger",
  aborted: "neutral",
  stuck: "amber",
  budget_exhausted: "amber",
} as const;

export function RunSummary({
  header,
  stepCount,
}: {
  header: ReturnType<typeof deriveRun>["header"];
  stepCount: number;
}) {
  const end = header.end;
  const cells: Array<[string, string]> = [
    ["steps", String(end?.steps ?? stepCount)],
    ["wall", formatMs(end?.wallMs)],
    ["cost", formatUsd(end?.costUsd)],
    ["jev calls", String(end?.decisionCalls ?? "–")],
    ["model calls", String(end?.modelCalls ?? "–")],
  ];
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1">
      {cells.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-1.5">
          <dt className="label">{k}</dt>
          <dd className="num text-xs">{v}</dd>
        </div>
      ))}
      {end && Object.keys(end.modeShares).length > 0 ? (
        <div className="flex items-baseline gap-1.5">
          <dt className="label">who did the work</dt>
          <dd className="num text-xs">
            {Object.entries(end.modeShares)
              .map(([m, p]) => `${m} ${Math.round(p * 100)}%`)
              .join(" · ")}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function LivePage({
  onOpenReplay,
  onNewTask,
}: {
  onOpenReplay: (runId: string) => void;
  onNewTask: () => void;
}) {
  const runId = useLiveStore((s) => s.runId);
  const status = useLiveStore((s) => s.status);
  const detail = useLiveStore((s) => s.detail);
  const outcome = useLiveStore((s) => s.outcome);
  const oraclePass = useLiveStore((s) => s.oraclePass);
  const events = useLiveStore((s) => s.events);
  const frame = useLiveStore((s) => s.frame);
  const [error, setError] = useState<string>();
  const { header, steps } = useMemo(() => deriveRun(events), [events]);
  // Only the step being acted on right now: an older box would sit on a page that has moved on.
  const running = status !== undefined && status !== "ended";
  const last = steps.at(-1);
  const target = running && last?.action?.target?.bounds ? last.action : undefined;
  const paused = status === "paused";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        void toggleTakeover().catch((err: unknown) => setError(errorMessage(err)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!runId) {
    return (
      <Empty title="No run yet">
        <p className="mb-3">Start a task to watch the agent here.</p>
        <Button variant="primary" onClick={onNewTask}>
          New task
        </Button>
      </Empty>
    );
  }

  const stop = () => void call("runs.stop", { runId }).catch((e: unknown) => setError(errorMessage(e)));

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex shrink-0 items-start justify-between gap-4 rounded-md border border-line bg-panel px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="label">run</span>
            <span className="num text-xs text-muted">{runId}</span>
            {header.taskId && header.taskId !== "adhoc" ? <Badge>{header.taskId}</Badge> : null}
            {status === "ended" && outcome ? (
              <Badge tone={OUTCOME_TONE[outcome]}>{outcome.replace("_", " ")}</Badge>
            ) : null}
            {status === "ended" && oraclePass !== undefined ? (
              <Badge tone={oraclePass ? "ok" : "danger"}>oracle {oraclePass ? "pass" : "fail"}</Badge>
            ) : null}
            {running ? <Badge tone={paused ? "amber" : "accent"}>{status}</Badge> : null}
          </div>
          <p className="mt-1 truncate text-[14px] font-medium">{header.instruction ?? "Starting…"}</p>
          <div className="mt-1.5">
            <RunSummary header={header} stepCount={steps.length} />
          </div>
          {detail && status === "ended" ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
          {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running ? (
            <>
              <Button
                variant={paused ? "primary" : "amber"}
                onClick={() => void toggleTakeover().catch((e: unknown) => setError(errorMessage(e)))}
                aria-keyshortcuts="Control+Shift+Space"
              >
                {paused ? <Play aria-hidden="true" /> : <Hand aria-hidden="true" />}
                {paused ? "Resume agent" : "Take over"}
                <span className="ml-1 hidden gap-0.5 xl:flex">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>⇧</Kbd>
                  <Kbd>Space</Kbd>
                </span>
              </Button>
              <Button variant="danger" onClick={stop} disabled={status === "stopping"}>
                <Square aria-hidden="true" />
                Stop
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => onOpenReplay(runId)}>Open replay</Button>
              <ReuseTaskButton runId={runId} onReady={onNewTask} />
              <Button variant="primary" onClick={onNewTask}>
                New task
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(380px,1fr)] gap-3">
        <Panel
          title="Live view"
          actions={
            header.surface ? (
              <span className="truncate font-mono text-2xs text-faint">{header.surface}</span>
            ) : null
          }
        >
          <ScreencastView
            src={frame?.src}
            meta={frame?.meta}
            target={
              target?.target?.bounds
                ? {
                    label: `${target.type} ${target.target.name || target.target.role}`,
                    bounds: target.target.bounds,
                    ...(target.target.confidence !== undefined
                      ? { confidence: target.target.confidence }
                      : {}),
                  }
                : undefined
            }
            live={running}
            paused={paused}
            emptyLabel={running ? "Waiting for the first frame…" : "The browser closed when the run ended."}
          />
        </Panel>
        <Panel title={`Steps · ${steps.length}`} actions={<TimingLegend />}>
          {steps.length === 0 ? (
            <Empty title="Waiting for the first step" />
          ) : (
            <StepTimeline steps={steps} follow={running} />
          )}
        </Panel>
      </div>
    </div>
  );
}
