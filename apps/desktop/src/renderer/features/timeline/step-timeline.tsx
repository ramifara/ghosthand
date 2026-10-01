// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The step tape: one row per step with the decision's probability strip, gates, effect, the time split
// (settle/observe/decide/act/verify) and cost. Rows expand to every Jev head and model call.
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { cn } from "../../lib/cn.ts";
import { formatMs, formatPct, formatUsd } from "../../lib/format.ts";
import { confidenceBand } from "../live/overlay-geometry.ts";
import { type AnswerView, type StepView, TIMING_PARTS } from "./derive-steps.ts";

const PART_STYLE: Record<(typeof TIMING_PARTS)[number], { label: string; className: string }> = {
  settleMs: { label: "settle", className: "bg-line-strong" },
  observeMs: { label: "observe", className: "bg-faint" },
  decideMs: { label: "decide", className: "bg-accent" },
  actMs: { label: "act", className: "bg-ink/70" },
  verifyMs: { label: "verify", className: "bg-amber/70" },
};

export function TimingLegend() {
  return (
    <div className="flex items-center gap-2.5" aria-hidden="true">
      {TIMING_PARTS.map((p) => (
        <span key={p} className="flex items-center gap-1 font-mono text-2xs text-muted">
          <span className={cn("inline-block size-2 rounded-[1px]", PART_STYLE[p].className)} />
          {PART_STYLE[p].label}
        </span>
      ))}
    </div>
  );
}

function TimeSplit({ step }: { step: StepView }) {
  const t = step.timing;
  if (!t) return <div className="h-1.5 w-full rounded-full bg-panel-2" />;
  const total = TIMING_PARTS.reduce((sum, p) => sum + t[p], 0) || 1;
  const title = TIMING_PARTS.map((p) => `${PART_STYLE[p].label} ${formatMs(t[p])}`).join(" · ");
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-panel-2" title={title}>
      {TIMING_PARTS.map((p) =>
        t[p] > 0 ? (
          <span key={p} className={PART_STYLE[p].className} style={{ width: `${(t[p] / total) * 100}%` }} />
        ) : null,
      )}
      <span className="sr-only">{title}</span>
    </div>
  );
}

/** The winner and its runners-up as one stacked strip. */
export function ProbabilityStrip({ answer, className }: { answer: AnswerView; className?: string }) {
  const band = confidenceBand(answer.confidence);
  if (answer.kind === "noul") {
    const p = answer.confidence ?? 0;
    return (
      <div className={cn("flex h-1.5 w-20 overflow-hidden rounded-full bg-panel-2", className)}>
        <span className="bg-accent" style={{ width: `${p * 100}%` }} />
      </div>
    );
  }
  return (
    <div className={cn("flex h-1.5 w-20 overflow-hidden rounded-full bg-panel-2", className)}>
      {answer.top.map((o, i) => (
        <span
          key={o.key}
          className={cn(
            i === 0 ? (band === "low" ? "bg-amber" : "bg-accent") : i === 1 ? "bg-faint" : "bg-line-strong",
            i > 0 && "border-l border-panel",
          )}
          style={{ width: `${o.p * 100}%` }}
        />
      ))}
    </div>
  );
}

function AnswerChip({ answer }: { answer: AnswerView }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-2xs text-faint">{answer.head}</span>
      <span className="max-w-[12rem] truncate font-mono text-xs">{answer.value}</span>
      <ProbabilityStrip answer={answer} className="w-12" />
      {answer.confidence !== undefined ? (
        <span className="num text-2xs text-muted">{formatPct(answer.confidence)}</span>
      ) : null}
    </span>
  );
}

const STATUS_MARK: Record<StepView["status"], { className: string; label: string }> = {
  acted: { className: "bg-accent", label: "acted" },
  verified: { className: "bg-ok", label: "verified" },
  refused: { className: "bg-amber", label: "refused by a gate" },
  noop: { className: "bg-danger", label: "no effect" },
  pending: { className: "bg-line-strong", label: "in progress" },
};

function StepDetails({ step }: { step: StepView }) {
  return (
    <div className="grid gap-3 border-t border-dashed border-line bg-panel-2/60 px-3 py-2.5 pl-[3.25rem]">
      {step.decisions.map((d, i) => (
        <div key={`${d.model}-${i}`}>
          <p className="label mb-1">
            Jev · {d.purpose} · <span className="normal-case">{d.model}</span> · {formatMs(d.latencyMs)} ·{" "}
            {d.inputTokens} tok · {formatUsd(d.costUsd)}
          </p>
          {d.error ? <p className="font-mono text-xs text-danger">{d.error}</p> : null}
          <table className="w-full text-xs">
            <tbody>
              {d.answers.map((a) => (
                <tr key={a.head} className="align-top">
                  <th scope="row" className="w-36 py-0.5 pr-3 text-left font-mono font-normal text-muted">
                    {a.head}
                  </th>
                  <td className="py-0.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {a.top.length > 0 ? (
                        a.top.map((o, j) => (
                          <span key={o.key} className={cn("font-mono", j === 0 ? "text-ink" : "text-faint")}>
                            {o.key} <span className="num">{o.p.toFixed(2)}</span>
                          </span>
                        ))
                      ) : (
                        <span className="font-mono">
                          {a.value}
                          {a.confidence !== undefined ? ` p=${a.confidence.toFixed(2)}` : ""}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {step.gates.length > 0 ? (
        <div>
          <p className="label mb-1">Gates</p>
          <ul className="flex flex-wrap gap-1.5">
            {step.gates.map((g, i) => (
              <li key={`${g.gate}-${i}`}>
                <Badge tone={g.passed ? "ok" : "amber"} title={g.detail}>
                  {g.passed ? "✓" : "✕"} {g.gate.replaceAll("_", " ")}
                  {g.detail && !g.passed ? <span className="normal-case">· {g.detail}</span> : null}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {step.calls.length > 0 ? (
        <div>
          <p className="label mb-1">Model calls</p>
          {step.calls.map((c, i) => (
            <p key={`${c.model}-${i}`} className="font-mono text-xs">
              {c.role} · {c.model} · {formatMs(c.latencyMs)} · {formatUsd(c.costUsd)}{" "}
              {c.ok ? "" : <span className="text-danger">failed</span>} {c.summary ? `— ${c.summary}` : ""}
            </p>
          ))}
        </div>
      ) : null}
      {step.effect ? (
        <p className="font-mono text-xs text-muted">
          effect {step.effect.effect} via {step.effect.route} in {formatMs(step.effect.durationMs)}
          {step.effect.error ? <span className="text-danger"> · {step.effect.error}</span> : null}
        </p>
      ) : null}
      {step.url ? <p className="truncate font-mono text-xs text-faint">{step.url}</p> : null}
    </div>
  );
}

export function StepRow({
  step,
  selected,
  onSelect,
}: {
  step: StepView;
  selected?: boolean;
  onSelect?: (step: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const act = step.decisions.find((d) => d.purpose === "act") ?? step.decisions[0];
  const op = act?.answers.find((a) => a.head === "operation");
  const target = act?.answers.find((a) => a.head.endsWith("_target") && a.head.startsWith(op?.value ?? "\0"));
  const failed = step.gates.filter((g) => !g.passed);
  const mark = STATUS_MARK[step.status];
  return (
    <li
      className={cn("border-b border-line last:border-b-0", selected && "bg-accent-soft/60")}
      aria-current={selected ? "step" : undefined}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Step ${step.step} details`}
          className="flex w-7 shrink-0 items-start justify-center pt-2.5 text-faint hover:text-ink"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={() => onSelect?.(step.step)}
          className="grid min-w-0 flex-1 grid-cols-[2.25rem_1fr_auto] gap-x-2 py-2 pr-3 text-left"
        >
          <span className="num pt-px text-xs text-muted">{String(step.step).padStart(3, "0")}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className={cn("size-1.5 shrink-0 rounded-full", mark.className)} title={mark.label} />
              <span className="truncate font-medium">
                {step.action?.summary ??
                  (failed.length > 0
                    ? `refused: ${failed.map((g) => g.gate.replaceAll("_", " ")).join(", ")}`
                    : null) ??
                  (step.verify ? `verify: ${step.verify.state} (${step.verify.decidedBy})` : "observing…")}
              </span>
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              {op ? <AnswerChip answer={op} /> : null}
              {target ? <AnswerChip answer={target} /> : null}
              {step.human.map((h, i) => (
                <Badge key={`${h.kind}-${i}`} tone="amber">
                  {h.kind}
                  {h.granted === false ? " denied" : h.kind === "approval" ? " granted" : ""}
                </Badge>
              ))}
              {step.escalations.map((e, i) => (
                <Badge key={`esc-${i}`} tone="neutral" title={e.reason}>
                  {e.from}→{e.to}
                </Badge>
              ))}
              {step.calls.length > 0 ? <Badge tone="accent">{step.calls.length} model call</Badge> : null}
            </span>
          </span>
          <span className="flex w-28 flex-col items-end gap-1">
            <span className="flex items-center gap-2">
              {step.mode ? <span className="font-mono text-2xs text-faint">{step.mode}</span> : null}
              <span className="num text-xs">
                {formatMs(
                  step.timing ? TIMING_PARTS.reduce((s, p) => s + (step.timing?.[p] ?? 0), 0) : undefined,
                )}
              </span>
            </span>
            <TimeSplit step={step} />
            <span className="num text-2xs text-muted">{formatUsd(step.costUsd)}</span>
          </span>
        </button>
      </div>
      {open ? <StepDetails step={step} /> : null}
    </li>
  );
}

export function StepTimeline({
  steps,
  selected,
  onSelect,
  follow,
}: {
  steps: readonly StepView[];
  selected?: number | undefined;
  onSelect?: (step: number) => void;
  /** Keep the newest step in view (live runs). */
  follow?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = steps.length;
  useEffect(() => {
    if (follow && count > 0) end.current?.scrollIntoView({ block: "end" });
  }, [follow, count]);
  return (
    <div className="h-full overflow-y-auto">
      <ol aria-label="Steps">
        {steps.map((s) => (
          <StepRow key={s.step} step={s} selected={selected === s.step} {...(onSelect ? { onSelect } : {})} />
        ))}
      </ol>
      <div ref={end} />
    </div>
  );
}
