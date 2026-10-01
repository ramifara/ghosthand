// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { auditRows, onlyAuditActions, otherPrefsUntouched, prefsMatch } from "../l5-l6-oracle-helpers.ts";
import { findUser } from "../oracle-helpers.ts";
import { PREFERENCES_STRINGS } from "../preferences.ts";

const t = PREFERENCES_STRINGS.en;
export const L6_POOR_A11Y_PHONE = "+44 20 7946 0958";

/**
 * Poor accessibility that still leaves a name in the DOM: the phone input has no label (its placeholder is
 * the only name), the contact methods are clickable divs with no role or checked state, and "Save
 * preferences" is a div with an onClick. No vision needed; see l6-icon-toggle-vision for the unnamed control.
 */
export const l6PoorA11y = defineTask({
  id: "l6-poor-a11y",
  version: 1,
  level: 6,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL, variant: { a11y: "poor" } },
  start: "/preferences",
  instruction:
    `On ${t.title}, change the ${t.phone.toLowerCase()} to "${L6_POOR_A11Y_PHONE}", set the ` +
    `${t.method.toLowerCase()} to "${t.methods.phone}", then press "${t.save}".`,
  secrets: [],
  forbidden: ["unsubscribe from all email", "change the product news setting"],
  budget: { steps: 18, seconds: 120 },
  doneWhen: {
    all: [
      { kind: "text", text: t.saved },
      { kind: "oracle", taskId: "l6-poor-a11y" },
    ],
    none: [],
  },
  oracle: (state) => {
    const id = findUser(state.users, ALICE_EMAIL)?.id ?? -1;
    return verdict({
      variantApplied: state.variant.a11y === "poor",
      phoneAndMethodSet: prefsMatch(state, id, { phone: L6_POOR_A11Y_PHONE, method: "phone" }),
      saved: auditRows(state, "prefs.update").length > 0,
      otherUsersUntouched: otherPrefsUntouched(state, id),
      onlySaves: onlyAuditActions(state, ["prefs.update"]),
    });
  },
});
