// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Replay viewer: a recorded run's events.jsonl as the step tape, with the screenshot taken at each step
// and the reticle on the element it acted on. J/K or the arrow keys move between steps.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ReuseTaskButton } from "../components/reuse-task-button.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Kbd } from "../components/ui/kbd.tsx";
import { Empty, Panel } from "../components/ui/panel.tsx";
import { ScreencastView } from "../features/live/screencast-view.tsx";
import { deriveRun } from "../features/timeline/derive-steps.ts";
import { StepTimeline, TimingLegend } from "../features/timeline/step-timeline.tsx";
import { call, errorMessage } from "../lib/bridge.ts";
import { RunSummary } from "./live-page.tsx";

export function ReplayPage({ runId, onTaskReady }: { runId: string; onTaskReady: () => void }) {
  const log = useQuery({
    queryKey: ["runs", runId, "events"],
    queryFn: () => call("runs.events", { runId }),
  });
  const { header, steps } = useMemo(() => deriveRun(log.data?.events ?? []), [log.data]);
  const [selected, setSelected] = useState<number>();
  const current = selected ?? steps[0]?.step;
  const step = steps.find((s) => s.step === current);
  const shot = useQuery({
    queryKey: ["runs", runId, "shot", current],
    queryFn: () => call("runs.screenshot", { runId, step: current ?? 0 }),
    enabled: current !== undefined && step?.hasScreenshot === true,
  });
  const [size, setSize] = useState<{ w: number; h: number }>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = steps.findIndex((s) => s.step === current);
      if (e.key === "j" || e.key === "ArrowDown")
        setSelected(steps[Math.min(steps.length - 1, idx + 1)]?.step);
      else if (e.key === "k" || e.key === "ArrowUp") setSelected(steps[Math.max(0, idx - 1)]?.step);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps, current]);

  useEffect(() => {
    const src = shot.data?.dataUrl;
    if (!src) return;
    const img = new Image();
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [shot.data]);

  if (log.isError) return <Empty title="Cannot open this run">{errorMessage(log.error)}</Empty>;

  const bounds = step?.action?.target?.bounds;
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="shrink-0 rounded-md border border-line bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="label">replay</span>
          <span className="num text-xs text-muted">{runId}</span>
          {header.taskId ? <Badge>{header.taskId}</Badge> : null}
          {header.end ? (
            <Badge tone={header.end.outcome === "success" ? "ok" : "amber"}>{header.end.outcome}</Badge>
          ) : null}
          <ReuseTaskButton runId={runId} onReady={onTaskReady} />
          <span className="ml-auto flex items-center gap-1 text-2xs text-muted">
            step <Kbd>J</Kbd> <Kbd>K</Kbd>
          </span>
        </div>
        <p className="mt-1 truncate text-[14px] font-medium">{header.instruction}</p>
        <div className="mt-1.5">
          <RunSummary header={header} stepCount={steps.length} />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(380px,1fr)] gap-3">
        <Panel title={current !== undefined ? `Screenshot · step ${current}` : "Screenshot"}>
          <ScreencastView
            src={shot.data?.dataUrl}
            meta={
              size
                ? {
                    deviceWidth: size.w,
                    deviceHeight: size.h,
                    offsetTop: 0,
                    pageScaleFactor: 1,
                    scrollOffsetX: 0,
                    scrollOffsetY: 0,
                  }
                : undefined
            }
            target={
              bounds && step?.action?.target
                ? {
                    label: `${step.action.type} ${step.action.target.name || step.action.target.role}`,
                    bounds,
                    ...(step.action.target.confidence !== undefined
                      ? { confidence: step.action.target.confidence }
                      : {}),
                  }
                : undefined
            }
            live={false}
            emptyLabel={step?.hasScreenshot === false ? "No screenshot for this step." : "Loading…"}
          />
        </Panel>
        <Panel title={`Steps · ${steps.length}`} actions={<TimingLegend />}>
          {log.isPending ? (
            <Empty title="Loading run…" />
          ) : (
            <StepTimeline steps={steps} selected={current} onSelect={setSelected} />
          )}
        </Panel>
      </div>
    </div>
  );
}
