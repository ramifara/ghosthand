// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Reporting an answer ("tell me the total", "report the average rating"): Jev picks the passage of the
// final page that answers the instruction; the writer composes free text only when no passage fits.
// The answer is graded by the task's oracle, never trusted by itself.
import type { DecisionProvider, Questions, Snapshot } from "@ghosthand/protocol";
import { choiceConfidence } from "./gates.ts";
import { ANTI_INJECTION, NONE } from "./questions.ts";
import type { SecretsRegistry } from "./secrets.ts";
import { buildState } from "./state-builder.ts";
import type { Writer } from "./writer.ts";

export const ANSWER_THRESHOLD = 0.6;
const MAX_PASSAGES = 254;

/** Candidate passages: page text lines and sentences, plus element names and contexts, deduplicated. */
export function answerPassages(snapshot: Snapshot): string[] {
  const raw = [
    ...snapshot.text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/),
    ...snapshot.elements.flatMap((e) => [e.name, e.context ?? ""]),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = r.replace(/\s+/g, " ").trim();
    if (t.length < 1 || t.length > 300 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  // Passages with digits or ids first: answers are usually facts.
  return out.sort((a, b) => Number(/\d/.test(b)) - Number(/\d/.test(a))).slice(0, MAX_PASSAGES);
}

export function answerQuestion(instruction: string, passages: string[]): Questions {
  const criteria: Record<string, string> = {};
  passages.forEach((p, i) => {
    criteria[`p${i}`] = p;
  });
  criteria[NONE] = "No single passage states the answer.";
  return {
    answer: {
      type: "choice",
      instructions: `The user asked: ${JSON.stringify(instruction)}. Which passage of the current page states the answer the user asked for? ${ANTI_INJECTION}`,
      criteria,
    },
  };
}

export interface AnswerResult {
  answer: string;
  by: "decision" | "writer" | "vision";
  costUsd: number;
  decisionCalls: number;
  modelCalls: number;
}

export async function extractAnswer(
  instruction: string,
  snapshot: Snapshot,
  deps: { decision: DecisionProvider; writer?: Writer; secrets: SecretsRegistry; signal?: AbortSignal },
): Promise<AnswerResult | undefined> {
  const passages = answerPassages(snapshot);
  let costUsd = 0;
  let decisionCalls = 0;
  let modelCalls = 0;
  if (passages.length > 0) {
    const state = buildState(
      { instruction, goal: instruction, step: 0, phase: "verify", snapshot, history: [], inputs: [] },
      deps.secrets,
    );
    const r = await deps.decision.ask(
      state,
      answerQuestion(instruction, passages),
      deps.signal ? { signal: deps.signal } : {},
    );
    decisionCalls++;
    if (r.ok) {
      costUsd += r.value.costUsd;
      const a = r.value.answers.answer;
      if (a?.type === "choice" && a.choice !== NONE && choiceConfidence(a) >= ANSWER_THRESHOLD) {
        const passage = passages[Number(a.choice.slice(1))];
        if (passage)
          return { answer: deps.secrets.redact(passage), by: "decision", costUsd, decisionCalls, modelCalls };
      }
    }
  }
  if (!deps.writer) return undefined;
  const page = JSON.stringify({
    title: snapshot.title,
    url: snapshot.url,
    text: snapshot.text.slice(0, 6000),
  });
  const w = await deps.writer.hint(
    {
      instruction,
      goal: instruction,
      page: deps.secrets.redact(page),
      history: [],
      reason: "report the answer",
      field: "answer",
    },
    deps.signal ? { signal: deps.signal } : {},
  );
  modelCalls++;
  if (!w.ok || w.value.hint.kind !== "text") return undefined;
  costUsd += w.value.costUsd;
  return { answer: deps.secrets.redact(w.value.hint.text), by: "writer", costUsd, decisionCalls, modelCalls };
}
