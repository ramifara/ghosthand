// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { ChoiceQuestion, Questions, ScoreQuestion } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import {
  validateAnswers,
  validateChoiceAnswer,
  validateNoulAnswer,
  validateScoreAnswer,
} from "./validate-response.ts";

const choiceQ: ChoiceQuestion = { type: "choice", criteria: { a: "first", b: "second", c: null } };
const scoreQ: ScoreQuestion = { type: "score", criteria: ["low", "mid", "high"] };

const goodChoice = {
  type: "choice",
  choice: "b",
  confidence: 0.8,
  probabilities: { a: 0.1, b: 0.85, c: 0.05 },
};
const goodScore = {
  type: "score",
  score: 1.2,
  confidence: 0.7,
  probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
};

const reasonOf = (a: { type: string; reason?: string }): string =>
  a.type === "abstain" ? (a.reason ?? "") : "";

describe("validateNoulAnswer", () => {
  it("maps the SDK `noul` field to `p`", () => {
    expect(validateNoulAnswer({ type: "noul", noul: 0.73 })).toEqual({ type: "noul", p: 0.73 });
  });

  it.each([-0.01, 1.01])("abstains when p = %s", (noul) => {
    expect(validateNoulAnswer({ type: "noul", noul }).type).toBe("abstain");
  });

  it("abstains on a missing or non-numeric field", () => {
    expect(validateNoulAnswer({ type: "noul" }).type).toBe("abstain");
    expect(validateNoulAnswer({ type: "noul", noul: "0.5" }).type).toBe("abstain");
  });
});

describe("validateChoiceAnswer", () => {
  it("accepts a well-formed answer", () => {
    expect(validateChoiceAnswer(choiceQ, goodChoice)).toEqual({
      type: "choice",
      choice: "b",
      confidence: 0.8,
      probabilities: { a: 0.1, b: 0.85, c: 0.05 },
    });
  });

  it("accepts a tie for the maximum", () => {
    const a = validateChoiceAnswer(choiceQ, { ...goodChoice, probabilities: { a: 0.45, b: 0.45, c: 0.1 } });
    expect(a.type).toBe("choice");
  });

  it("accepts a sum just inside the tolerance and rejects one just outside", () => {
    expect(
      validateChoiceAnswer(choiceQ, { ...goodChoice, probabilities: { a: 0.1, b: 0.82, c: 0.06 } }).type,
    ).toBe("choice"); // 0.98
    const off = validateChoiceAnswer(choiceQ, { ...goodChoice, probabilities: { a: 0.1, b: 0.8, c: 0.07 } }); // 0.97
    expect(reasonOf(off)).toMatch(/sum to 0\.97/);
  });

  it("abstains on a missing option key", () => {
    const a = validateChoiceAnswer(choiceQ, { ...goodChoice, probabilities: { a: 0.1, b: 0.9 } });
    expect(reasonOf(a)).toMatch(/missing c/);
  });

  it("abstains on an unexpected option key", () => {
    const a = validateChoiceAnswer(choiceQ, {
      ...goodChoice,
      probabilities: { a: 0.1, b: 0.8, c: 0.05, d: 0.05 },
    });
    expect(reasonOf(a)).toMatch(/unexpected d/);
  });

  it("abstains on a probability outside [0, 1]", () => {
    const a = validateChoiceAnswer(choiceQ, { ...goodChoice, probabilities: { a: -0.1, b: 1.1, c: 0 } });
    expect(reasonOf(a)).toMatch(/outside \[0, 1\]/);
  });

  it("abstains when the choice is not the argmax", () => {
    const a = validateChoiceAnswer(choiceQ, { ...goodChoice, choice: "a" });
    expect(reasonOf(a)).toMatch(/not the argmax/);
  });

  it("abstains when the choice is not an option", () => {
    const a = validateChoiceAnswer(choiceQ, { ...goodChoice, choice: "z" });
    expect(reasonOf(a)).toMatch(/not an option/);
  });

  it("abstains on a confidence outside [0, 1]", () => {
    expect(validateChoiceAnswer(choiceQ, { ...goodChoice, confidence: 1.5 }).type).toBe("abstain");
  });

  it("abstains on a malformed answer", () => {
    expect(validateChoiceAnswer(choiceQ, { type: "choice", choice: "b" }).type).toBe("abstain");
  });
});

describe("validateScoreAnswer", () => {
  it("accepts a score equal to the distribution mean", () => {
    expect(validateScoreAnswer(scoreQ, goodScore)).toEqual({
      type: "score",
      score: 1.2,
      confidence: 0.7,
      probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
    });
  });

  it("accepts a score within 0.02 of the mean and rejects one beyond", () => {
    expect(validateScoreAnswer(scoreQ, { ...goodScore, score: 1.215 }).type).toBe("score");
    const a = validateScoreAnswer(scoreQ, { ...goodScore, score: 1.25 });
    expect(reasonOf(a)).toMatch(/distribution mean 1\.2000/);
  });

  it("abstains when level keys differ from the level indices", () => {
    const a = validateScoreAnswer(scoreQ, { ...goodScore, probabilities: { "1": 0.6, "2": 0.3, "3": 0.1 } });
    expect(reasonOf(a)).toMatch(/missing 0; unexpected 3/);
  });

  it("abstains when probabilities do not sum to 1", () => {
    const a = validateScoreAnswer(scoreQ, { ...goodScore, probabilities: { "0": 0.5, "1": 0.6, "2": 0.3 } });
    expect(reasonOf(a)).toMatch(/sum to 1\.4/);
  });

  it("abstains on a malformed answer", () => {
    expect(validateScoreAnswer(scoreQ, { type: "score", score: 1 }).type).toBe("abstain");
  });
});

describe("validateAnswers", () => {
  const questions: Questions = {
    done: { type: "noul" },
    pick: choiceQ,
    level: scoreQ,
  };

  it("validates each answer by question type", () => {
    const out = validateAnswers(questions, {
      done: { type: "noul", noul: 0.2 },
      pick: goodChoice,
      level: goodScore,
    });
    expect(out.done).toEqual({ type: "noul", p: 0.2 });
    expect(out.pick?.type).toBe("choice");
    expect(out.level?.type).toBe("score");
  });

  it("abstains every answer when a key is missing", () => {
    const out = validateAnswers(questions, { done: { type: "noul", noul: 0.2 }, pick: goodChoice });
    expect(Object.keys(out).sort()).toEqual(["done", "level", "pick"]);
    for (const a of Object.values(out)) expect(reasonOf(a)).toMatch(/missing level/);
  });

  it("abstains every answer when an unexpected key appears", () => {
    const out = validateAnswers(questions, {
      done: { type: "noul", noul: 0.2 },
      pick: goodChoice,
      level: goodScore,
      extra: { type: "noul", noul: 0.5 },
    });
    expect(Object.keys(out)).not.toContain("extra");
    for (const a of Object.values(out)) expect(reasonOf(a)).toMatch(/unexpected extra/);
  });

  it("abstains an answer whose type differs from its question", () => {
    const out = validateAnswers(questions, {
      done: goodChoice,
      pick: goodChoice,
      level: goodScore,
    });
    expect(reasonOf(out.done ?? { type: "x" })).toMatch(/expected a noul answer, got choice/);
    expect(out.pick?.type).toBe("choice");
  });

  it("abstains an answer that is not an object", () => {
    const out = validateAnswers(questions, { done: null, pick: goodChoice, level: goodScore });
    expect(out.done?.type).toBe("abstain");
  });
});
