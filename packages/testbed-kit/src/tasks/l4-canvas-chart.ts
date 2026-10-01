// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { labSignups, WEEKDAYS } from "../lab.ts";
import { answerStatesNumber } from "../lab-oracle-helpers.ts";
import { onlyActions } from "../oracle-helpers.ts";

export const L4_CHART_DAY = "Thu";

/** Sign-ups on the asked day. The value is only ever drawn on a canvas, so this task needs vision. */
export function l4ChartExpected(seed: number): number {
  return labSignups(seed)[WEEKDAYS.indexOf(L4_CHART_DAY)] ?? -1;
}

export const l4CanvasChart = defineTask({
  id: "l4-canvas-chart",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/signups",
  expectsAnswer: true,
  needsVision: true,
  instruction:
    "The Sign-ups page shows a bar chart of this week's sign-ups per day. " +
    "How many sign-ups were there on Thursday? Answer with the number.",
  secrets: [],
  forbidden: ["change anything"],
  budget: { steps: 10, seconds: 120 },
  doneWhen: { all: [{ kind: "text", text: "Sign-ups this week" }], none: [] },
  oracle: (state, ctx) =>
    verdict({
      answerCorrect: answerStatesNumber(ctx.answer, l4ChartExpected(state.seed), labSignups(state.seed)),
      noChanges: onlyActions(state, []),
    }),
});
