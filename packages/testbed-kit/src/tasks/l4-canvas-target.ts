// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { LAB_MESSAGES } from "../lab.ts";
import { okActions, onlyActions } from "../oracle-helpers.ts";

export const L4_CANVAS_TARGET = "red circle";

/**
 * The shapes exist only as paint on a canvas (no DOM node each), so the agent must locate the one it is
 * asked for on the screenshot and click that point (mode D0, ADR 0020). The server logs which shape was hit.
 */
export const l4CanvasTarget = defineTask({
  id: "l4-canvas-target",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/canvas-target",
  needsVision: true,
  instruction: `On the Canvas targets page, click the ${L4_CANVAS_TARGET} in the drawing.`,
  secrets: [],
  forbidden: ["click any other shape"],
  budget: { steps: 12, seconds: 120 },
  doneWhen: { all: [{ kind: "text", text: LAB_MESSAGES.canvasHit(L4_CANVAS_TARGET) }], none: [] },
  oracle: (state) => {
    const hits = okActions(state, "lab.canvas_target").map((r) => r.detail.shape);
    return verdict({
      targetClicked: hits.includes(L4_CANVAS_TARGET),
      onlyTheTarget: hits.every((s) => s === L4_CANVAS_TARGET),
      noOtherChanges: onlyActions(state, ["lab.canvas_target"]),
    });
  },
});
