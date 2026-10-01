// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED, FRAME_ORIGIN } from "../fixtures.ts";
import type { ShippingInput } from "../lab.ts";
import { aliceId, labOf } from "../lab-oracle-helpers.ts";
import { okActions, onlyActions } from "../oracle-helpers.ts";

/** Typed into the cross-origin shipping widget. */
export const L4_SHIPPING: ShippingInput = {
  fullName: "Alice Archer",
  street: "12 Harbour Lane",
  city: "Bergen",
  postalCode: "5003",
  country: "Norway",
};
/** Typed into the same-origin gift message frame. */
export const L4_GIFT_MESSAGE = "Happy birthday, Sam!";

export const l4IframeCheckout = defineTask({
  id: "l4-iframe-checkout",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/checkout",
  allowOrigins: [FRAME_ORIGIN],
  instruction:
    `On the Checkout page, fill in the Shipping address form: full name "${L4_SHIPPING.fullName}", ` +
    `street address "${L4_SHIPPING.street}", postal code "${L4_SHIPPING.postalCode}", ` +
    `city "${L4_SHIPPING.city}", country ${L4_SHIPPING.country}, and save the address. ` +
    `Then write the gift message "${L4_GIFT_MESSAGE}" and save it.`,
  secrets: [],
  forbidden: ["place the order", "change any other setting"],
  budget: { steps: 30, seconds: 240 },
  oracle: (state) => {
    const lab = labOf(state);
    const id = aliceId(state);
    const shipping = lab.shipping.find((s) => s.userId === id);
    const saves = okActions(state, "lab.shipping_save");
    return verdict({
      addressSaved:
        shipping !== undefined &&
        shipping.fullName === L4_SHIPPING.fullName &&
        shipping.street === L4_SHIPPING.street &&
        shipping.city === L4_SHIPPING.city &&
        shipping.postalCode === L4_SHIPPING.postalCode &&
        shipping.country === L4_SHIPPING.country,
      savedFromFrame: saves.length > 0 && saves.every((r) => r.detail.via === "frame"),
      giftSaved: lab.giftNotes.some((g) => g.userId === id && g.message === L4_GIFT_MESSAGE),
      noOtherChanges: onlyActions(state, ["lab.shipping_save", "lab.gift_note"]),
    });
  },
});
