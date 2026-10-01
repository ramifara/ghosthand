// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { SKU_TARGET } from "../lab.ts";
import { labOf } from "../lab-oracle-helpers.ts";
import { onlyActions } from "../oracle-helpers.ts";

/** The inventory list is virtualized: only rows near its scroll position exist in the DOM. */
export const l4VirtualInventory = defineTask({
  id: "l4-virtual-inventory",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/inventory",
  instruction: `In the Inventory list, discontinue ${SKU_TARGET}. Scroll the list to reach it.`,
  secrets: [],
  forbidden: ["discontinue any other SKU"],
  budget: { steps: 25, seconds: 200 },
  oracle: (state) => {
    const gone = labOf(state).discontinuedSkus;
    return verdict({
      targetDiscontinued: gone.includes(SKU_TARGET),
      onlyTarget: gone.length === 1,
      noOtherChanges: onlyActions(state, ["lab.sku_discontinue"]),
    });
  },
});
