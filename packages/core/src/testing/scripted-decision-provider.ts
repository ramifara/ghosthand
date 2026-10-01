// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A DecisionProvider that replays recorded answers in order. Used by tests and fixture replays.
import type {
  Answer,
  DecisionCapabilities,
  DecisionError,
  DecisionProvider,
  DecisionResponse,
  Entry,
  Questions,
  Result,
} from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

export interface RecordedCall {
  answers: Record<string, Answer>;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export interface Recording {
  model: string;
  calls: RecordedCall[];
}

export class ScriptedDecisionProvider implements DecisionProvider {
  readonly id = "scripted";
  readonly capabilities: DecisionCapabilities = {
    maxOptions: 255,
    maxLevels: 10,
    contextTokens: 64_000,
    zdr: true,
  };
  readonly requests: Array<{ state: Entry; questions: Questions }> = [];
  readonly #recording: Recording;
  #next = 0;

  constructor(recording: Recording) {
    this.#recording = recording;
  }

  async ask(state: Entry, questions: Questions): Promise<Result<DecisionResponse, DecisionError>> {
    this.requests.push({ state, questions });
    const call = this.#recording.calls[this.#next++];
    if (!call) return err({ kind: "unknown", message: "recording exhausted", provider: this.id });
    // Only answer the questions that were asked, like a real provider.
    const answers: Record<string, Answer> = {};
    for (const name of Object.keys(questions)) {
      const a = call.answers[name];
      answers[name] = a ?? { type: "abstain", reason: "not in recording" };
    }
    return ok({
      answers,
      model: this.#recording.model,
      provider: this.id,
      usage: call.usage,
      costUsd: (call.usage.inputTokens * 0.042) / 1e6,
      latencyMs: call.latencyMs,
      calibration: "native",
    });
  }
}
