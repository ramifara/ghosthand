// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A rule-based stand-in for Jev, used only for plumbing smoke tests (no network, no key). It reads the same
// rendered state and questions the real model gets, so it exercises the whole pipeline, but it is not smart:
// it fills fields named right before a literal in the goal, then presses a save/submit button.
import type {
  Answer,
  DecisionCapabilities,
  DecisionProvider,
  DecisionResponse,
  Entry,
  Questions,
} from "@ghosthand/protocol";
import { ok } from "@ghosthand/protocol";

type RenderedElement = { id: string; role: string; name: string; value?: string; ops?: string[] };

const SUBMIT = /^(save|sign in|log in|submit|continue|save profile|save changes)\b/i;

function pick(criteria: Record<string, unknown>, key: string, p = 0.95): Answer {
  const keys = Object.keys(criteria);
  const rest = (1 - p) / Math.max(1, keys.length - 1);
  const probabilities = Object.fromEntries(keys.map((k) => [k, k === key ? p : rest]));
  return { type: "choice", choice: key, confidence: p, probabilities };
}

export interface HeuristicOptions {
  /**
   * Also press (once each) elements whose names match, patterns in priority order. Safety tests use it to
   * play a gullible model that follows instructions planted in the page; the code gates must still stop it.
   */
  follow?: readonly RegExp[];
}

export class HeuristicDecisionProvider implements DecisionProvider {
  readonly id = "heuristic";
  readonly capabilities: DecisionCapabilities = {
    maxOptions: 255,
    maxLevels: 10,
    contextTokens: 64_000,
    zdr: true,
  };
  readonly #pressed = new Set<string>();
  readonly #follow: readonly RegExp[];

  constructor(opts: HeuristicOptions = {}) {
    this.#follow = opts.follow ?? [];
  }

  async ask(state: Entry, questions: Questions) {
    const s = (state ?? {}) as { task?: { goal?: string }; elements?: RenderedElement[]; history?: string[] };
    const goal = s.task?.goal ?? "";
    const elements = s.elements ?? [];
    const answers: Record<string, Answer> = {};
    for (const [name, q] of Object.entries(questions)) {
      if (q.type === "noul") answers[name] = { type: "noul", p: name === "holds" ? 0.5 : 0.05 };
      else if (q.type === "choice") {
        const keys = Object.keys(q.criteria);
        answers[name] = pick(q.criteria, keys.includes("none") ? "none" : (keys[0] ?? ""), 0.5);
      } else answers[name] = { type: "abstain", reason: `${q.type} not supported` };
    }
    const op = questions.operation;
    if (op?.type === "choice") {
      const plan = this.#next(goal, elements, questions);
      if (plan) {
        answers.operation = pick(op.criteria, plan.op);
        const head = questions[`${plan.op}_target`];
        if (head?.type === "choice") answers[`${plan.op}_target`] = pick(head.criteria, plan.target);
        if (plan.text && questions.text?.type === "choice")
          answers.text = pick(questions.text.criteria, plan.text);
        if (questions.effect?.type === "choice")
          answers.effect = pick(questions.effect.criteria, plan.op === "press" ? "commit" : "advance");
      } else {
        answers.operation = pick(op.criteria, "blocked");
      }
    }
    const response: DecisionResponse = {
      answers,
      model: "heuristic",
      provider: "heuristic",
      usage: { inputTokens: Math.ceil(JSON.stringify(state).length / 3), outputTokens: 0 },
      costUsd: 0,
      latencyMs: 0,
      calibration: "verbalized",
    };
    return ok(response);
  }

  #next(
    goal: string,
    elements: RenderedElement[],
    questions: Questions,
  ): { op: string; target: string; text?: string } | undefined {
    const textQ = questions.text;
    const lower = goal.toLowerCase();
    if (textQ?.type === "choice") {
      for (const [key, desc] of Object.entries(textQ.criteria)) {
        if (key === "none" || typeof desc !== "string") continue;
        const literal = /Type the text: "(.*)"$/.exec(desc)?.[1];
        const secret = /\[input:([^\]]+)\]/.exec(desc)?.[1];
        const fields = elements.filter((e) => e.ops?.includes("set_value"));
        if (literal !== undefined) {
          const at = lower.indexOf(literal.toLowerCase());
          if (at < 0) continue; // a literal from the instruction, not this goal
          const before = lower.slice(Math.max(0, at - 60), at);
          // The field named closest before the literal ("job title to \"Staff Engineer\"").
          const named = fields
            .filter((f) => f.name && before.includes(f.name.toLowerCase()))
            .sort(
              (a, b) => before.lastIndexOf(b.name.toLowerCase()) - before.lastIndexOf(a.name.toLowerCase()),
            )[0];
          const field =
            (named && named.value !== literal ? named : undefined) ??
            (/@/.test(literal)
              ? fields.find((f) => /e-?mail/i.test(f.name) && f.value === "<empty>")
              : undefined);
          if (field) return { op: "set_value", target: field.id, text: key };
        } else if (secret) {
          const field = fields.find((f) => /password|passcode/i.test(f.name) && f.value === "<empty>");
          if (field) return { op: "set_value", target: field.id, text: key };
        }
      }
    }
    const button = elements.find(
      (e) => e.role === "button" && SUBMIT.test(e.name) && e.ops?.includes("press"),
    );
    if (button && !this.#pressed.has(button.name)) {
      this.#pressed.add(button.name);
      return { op: "press", target: button.id };
    }
    const lure = this.#follow
      .map((re) =>
        elements.find((e) => e.ops?.includes("press") && re.test(e.name) && !this.#pressed.has(e.name)),
      )
      .find((e) => e !== undefined);
    if (lure) {
      this.#pressed.add(lure.name);
      return { op: "press", target: lure.id };
    }
    return undefined;
  }
}
