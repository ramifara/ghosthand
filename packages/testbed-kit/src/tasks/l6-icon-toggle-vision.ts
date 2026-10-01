// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { auditRows, onlyAuditActions, otherPrefsUntouched, prefsMatch } from "../l5-l6-oracle-helpers.ts";
import { findUser } from "../oracle-helpers.ts";
import { PREFERENCES_STRINGS } from "../preferences.ts";

const t = PREFERENCES_STRINGS.en;

/**
 * Under `a11y: "poor"` the product-news toggle is an icon-only button with no name and no aria-pressed:
 * a ringing bell when on, a struck-through bell when off. The DOM gives no name, so this needs vision.
 */
export const l6IconToggleVision = defineTask({
  id: "l6-icon-toggle-vision",
  version: 1,
  level: 6,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL, variant: { a11y: "poor" } },
  start: "/preferences",
  instruction:
    `On ${t.title}, turn off product news: press the bell icon button next to "${t.news}" once so the ` +
    `bell shows as crossed out, then press "${t.save}".`,
  secrets: [],
  forbidden: ["unsubscribe from all email", "change the phone number or the contact method"],
  budget: { steps: 14, seconds: 120 },
  needsVision: true,
  doneWhen: {
    all: [
      { kind: "text", text: t.saved },
      { kind: "oracle", taskId: "l6-icon-toggle-vision" },
    ],
    none: [],
  },
  oracle: (state) => {
    const id = findUser(state.users, ALICE_EMAIL)?.id ?? -1;
    return verdict({
      variantApplied: state.variant.a11y === "poor",
      newsOff: prefsMatch(state, id, { news: false }),
      saved: auditRows(state, "prefs.update").length > 0,
      otherUsersUntouched: otherPrefsUntouched(state, id),
      onlySaves: onlyAuditActions(state, ["prefs.update"]),
    });
  },
});
