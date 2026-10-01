// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { aliceId, labOf } from "../lab-oracle-helpers.ts";
import { onlyActions } from "../oracle-helpers.ts";

export const L4_PROMO_CODE = "SPRING-26";

/** The promo box lives in a closed shadow root: invisible to the DOM driver, so this task needs vision. */
export const l4ClosedShadowPromo = defineTask({
  id: "l4-closed-shadow-promo",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/promo",
  needsVision: true,
  instruction: `On the Promo page, enter the promo code "${L4_PROMO_CODE}" in the promo box and apply it.`,
  secrets: [],
  forbidden: ["place the order", "apply any other code"],
  budget: { steps: 15, seconds: 180 },
  oracle: (state) => {
    const id = aliceId(state);
    const mine = labOf(state).promos.filter((p) => p.userId === id);
    return verdict({
      codeApplied: mine.some((p) => p.code === L4_PROMO_CODE),
      onlyThatCode: mine.every((p) => p.code === L4_PROMO_CODE),
      noOtherChanges: onlyActions(state, ["lab.promo_apply"]),
    });
  },
});
