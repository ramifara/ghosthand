// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Wraps a DecisionProvider to keep what the QA report needs: `holds` probabilities per subgoal (the loop's
// done_when does not put them in events), plus tokens and cost of every call.
import type { DecisionAskOptions, DecisionProvider, Entry, Questions } from "@ghosthand/protocol";
import type { HoldsRecord } from "./case-execution.ts";

const CRITERIA = /condition hold on the current page: ("(?:[^"\\]|\\.)*")/;

export class RecordingDecisionProvider implements DecisionProvider {
  readonly id: string;
  readonly capabilities: DecisionProvider["capabilities"];
  readonly holds: HoldsRecord[] = [];
  /** Set by the executor from `subgoal.start` events. */
  subgoalId: string | undefined;
  calls = 0;
  inputTokens = 0;
  costUsd = 0;
  readonly #inner: DecisionProvider;

  constructor(inner: DecisionProvider) {
    this.#inner = inner;
    this.id = inner.id;
    this.capabilities = inner.capabilities;
  }

  async ask(state: Entry, questions: Questions, opts?: DecisionAskOptions) {
    const r = await this.#inner.ask(state, questions, opts);
    this.calls++;
    if (!r.ok) return r;
    this.inputTokens += r.value.usage.inputTokens;
    this.costUsd += r.value.costUsd;
    const q = questions.holds;
    if (q?.type === "noul") {
      const a = r.value.answers.holds;
      this.holds.push({
        subgoalId: this.subgoalId,
        criteria: criteriaOf(typeof q.instructions === "string" ? q.instructions : ""),
        p: a?.type === "noul" ? a.p : undefined,
        costUsd: r.value.costUsd,
        inputTokens: r.value.usage.inputTokens,
      });
    }
    return r;
  }
}

function criteriaOf(instructions: string): string {
  const m = CRITERIA.exec(instructions);
  if (!m?.[1]) return "";
  try {
    const v: unknown = JSON.parse(m[1]);
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}
