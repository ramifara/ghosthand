// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One line per step on stderr while a run is going.
import type { RunEvent } from "@ghosthand/protocol";
import { ms, usd } from "./format.ts";

export function progressPrinter(write: (line: string) => void = (l) => process.stderr.write(`${l}\n`)) {
  let lastAction = "";
  let lastDecideMs = 0;
  return (e: RunEvent): void => {
    switch (e.type) {
      case "plan":
        write(`plan: ${e.plan.subgoals.map((g) => g.id).join(" → ")} (${e.plan.source})`);
        break;
      case "decision.answer":
        lastDecideMs = e.latencyMs;
        if (e.error) write(`  jev error: ${e.error.kind}: ${e.error.message}`);
        break;
      case "action": {
        const a = e.action;
        const what =
          a.type === "set_value"
            ? `${typeof a.value === "string" ? JSON.stringify(a.value) : `[input:${a.value.secretRef}]`} → `
            : a.type === "select_option"
              ? `${JSON.stringify(a.option)} in `
              : "";
        lastAction = `${a.type} ${what}${e.target ? `${e.target.role} "${e.target.name}"` : ""}`;
        break;
      }
      case "effect":
        write(
          `step ${String(e.step).padStart(2)} [${e.result.effect}] ${lastAction} (act ${ms(e.result.durationMs)}, jev ${ms(lastDecideMs)})`,
        );
        break;
      case "gate":
        if (!e.passed) write(`  gate ${e.gate} refused${e.detail ? `: ${e.detail}` : ""}`);
        break;
      case "escalate":
        write(`  ${e.direction === "down" ? "de-escalate" : "escalate"} ${e.from} → ${e.to}: ${e.reason}`);
        break;
      case "model.call":
        write(`  ${e.role} (${e.model}) ${ms(e.latencyMs)}${e.summary ? `: ${e.summary}` : ""}`);
        break;
      case "verify":
        write(`  verify ${e.state} (by ${e.decidedBy})`);
        break;
      case "run.end": {
        const order = ["A", "B", "C", "D1", "D2", "H"];
        const shares = Object.entries(e.modeShares)
          .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
          .map(([m, v]) => `${m} ${Math.round(v * 100)}%`)
          .join(", ");
        write(
          `${e.outcome}: ${e.reason}\nwho did the work: ${shares || "-"} · ${e.steps} steps · jev ${e.decisionCalls} · llm ${e.modelCalls} · ${ms(e.wallMs)} · ${usd(e.costUsd)}`,
        );
        break;
      }
      default:
        break;
    }
  };
}
