// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// OpenTelemetry spans per run, subgoal, step and decision call, derived from the run's event stream and
// exported as JSON lines into the run folder. Nothing leaves the machine; an OTLP exporter can be added later.
import { appendFileSync } from "node:fs";
import type { RunEvent } from "@ghosthand/protocol";
import { type Context, context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { type ExportResult, ExportResultCode, hrTimeToMilliseconds } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";

export class JsonlSpanExporter implements SpanExporter {
  readonly #path: string;
  readonly #redact: (text: string) => string;

  constructor(path: string, redact: (text: string) => string) {
    this.#path = path;
    this.#redact = redact;
  }

  export(spans: ReadableSpan[], done: (r: ExportResult) => void): void {
    try {
      const lines = spans.map((s) =>
        this.#redact(
          JSON.stringify({
            traceId: s.spanContext().traceId,
            spanId: s.spanContext().spanId,
            parentSpanId: s.parentSpanContext?.spanId,
            name: s.name,
            startMs: hrTimeToMilliseconds(s.startTime),
            durationMs: hrTimeToMilliseconds(s.duration),
            status: s.status.code === SpanStatusCode.ERROR ? "error" : "ok",
            attributes: s.attributes,
          }),
        ),
      );
      appendFileSync(this.#path, `${lines.join("\n")}\n`);
      done({ code: ExportResultCode.SUCCESS });
    } catch (e) {
      done({ code: ExportResultCode.FAILED, error: e instanceof Error ? e : new Error(String(e)) });
    }
  }

  async shutdown(): Promise<void> {}
}

export interface RunTracing {
  /** Feed every recorded event; spans open and close from the stream. */
  onEvent(event: RunEvent): void;
  shutdown(): Promise<void>;
}

export function createRunTracing(path: string, redact: (text: string) => string): RunTracing {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new JsonlSpanExporter(path, redact))],
  });
  const tracer = provider.getTracer("ghosthand");
  let run: Span | undefined;
  let runCtx: Context = context.active();
  let subgoal: Span | undefined;
  let subgoalCtx: Context = context.active();
  const steps = new Map<number, { span: Span; ctx: Context }>();

  const stepSpan = (step: number, t: number) => {
    let s = steps.get(step);
    if (!s) {
      const span = tracer.startSpan("step", { startTime: t, attributes: { step } }, subgoalCtx);
      s = { span, ctx: trace.setSpan(subgoalCtx, span) };
      steps.set(step, s);
    }
    return s;
  };

  return {
    onEvent(e) {
      switch (e.type) {
        case "run.start":
          run = tracer.startSpan("run", {
            startTime: e.t,
            attributes: {
              "run.id": e.runId,
              "task.id": e.task.id,
              mode: e.task.mode,
              model: e.decisionModel,
            },
          });
          runCtx = trace.setSpan(context.active(), run);
          subgoalCtx = runCtx;
          break;
        case "subgoal.start":
          subgoal = tracer.startSpan(
            "subgoal",
            { startTime: e.t, attributes: { "subgoal.id": e.subgoalId } },
            runCtx,
          );
          subgoalCtx = trace.setSpan(runCtx, subgoal);
          break;
        case "observe":
          stepSpan(e.step, e.t).span.setAttribute("elements", e.elementCount);
          break;
        case "decision.answer": {
          const parent = stepSpan(e.step, e.t).ctx;
          const span = tracer.startSpan(
            "decision",
            {
              startTime: e.t - e.latencyMs,
              attributes: {
                model: e.model,
                "tokens.input": e.inputTokens,
                "cost.usd": e.costUsd,
                "latency.ms": e.latencyMs,
                ...(e.requestId ? { "request.id": e.requestId } : {}),
              },
            },
            parent,
          );
          if (e.error) span.setStatus({ code: SpanStatusCode.ERROR, message: e.error.kind });
          span.end(e.t);
          break;
        }
        case "model.call": {
          const parent = e.step !== undefined ? stepSpan(e.step, e.t).ctx : runCtx;
          const span = tracer.startSpan(
            "model",
            {
              startTime: e.t - e.latencyMs,
              attributes: { role: e.role, model: e.model, "latency.ms": e.latencyMs },
            },
            parent,
          );
          if (!e.ok) span.setStatus({ code: SpanStatusCode.ERROR });
          span.end(e.t);
          break;
        }
        case "step.end": {
          const s = stepSpan(e.step, e.t);
          s.span.setAttributes({
            mode: e.mode,
            "settle.ms": e.timing.settleMs,
            "observe.ms": e.timing.observeMs,
            "decide.ms": e.timing.decideMs,
            "act.ms": e.timing.actMs,
            "verify.ms": e.timing.verifyMs,
          });
          s.span.end(e.t);
          steps.delete(e.step);
          break;
        }
        case "subgoal.end":
          subgoal?.setAttributes({ state: e.state, steps: e.steps });
          subgoal?.end(e.t);
          subgoal = undefined;
          subgoalCtx = runCtx;
          break;
        case "run.end":
          for (const s of steps.values()) s.span.end(e.t);
          steps.clear();
          subgoal?.end(e.t);
          run?.setAttributes({
            outcome: e.outcome,
            steps: e.steps,
            "cost.usd": e.costUsd,
            "decision.calls": e.decisionCalls,
          });
          if (e.outcome !== "success") run?.setStatus({ code: SpanStatusCode.ERROR, message: e.outcome });
          run?.end(e.t);
          break;
        default:
          break;
      }
    },
    shutdown: () => provider.shutdown(),
  };
}
