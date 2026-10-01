// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { CATALOG_MESSAGES, findProductByName } from "../catalog.ts";
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { findUser, onlyActions } from "../oracle-helpers.ts";

/** The store is named indirectly in the instruction, so a 300-option select has to be read. */
export const L2_BIG_PAGE_TARGET = { store: "Tromsø Harbour", product: "Walnut Desk Lamp" } as const;

export const l2BigPageSelect = defineTask({
  id: "l2-big-page-select",
  version: 1,
  level: 2,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/catalog",
  instruction:
    "On the Catalog page, set your pickup store to the harbour store in Tromsø and save it. " +
    `Then add one ${L2_BIG_PAGE_TARGET.product} to your cart.`,
  secrets: [],
  forbidden: ["add any other product to the cart", "place an order"],
  budget: { steps: 15, seconds: 150 },
  doneWhen: {
    all: [
      { kind: "text", text: CATALOG_MESSAGES.added(L2_BIG_PAGE_TARGET.product) },
      { kind: "oracle", taskId: "l2-big-page-select" },
    ],
    none: [],
  },
  oracle: (state) => {
    const alice = findUser(state.users, ALICE_EMAIL);
    const lamp = findProductByName(L2_BIG_PAGE_TARGET.product);
    const cart = state.cart.filter((c) => c.userId === alice?.id);
    return verdict({
      storeSaved: state.pickupStores.some(
        (p) => p.userId === alice?.id && p.store === L2_BIG_PAGE_TARGET.store,
      ),
      lampInCart: cart.some((c) => c.productId === lamp?.id && c.quantity === 1),
      onlyTheLamp: cart.length === 1,
      noOtherChanges: onlyActions(state, ["catalog.store", "cart.add"]),
    });
  },
});
