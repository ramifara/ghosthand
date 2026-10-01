// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import type { PrefsInput } from "../lab.ts";
import { aliceId, labOf } from "../lab-oracle-helpers.ts";
import { okActions, onlyActions } from "../oracle-helpers.ts";

export const L4_PREFS: PrefsInput = { digestAt: "18:00", weeklySummary: true };

/** The preferences form lives in an open shadow root of a custom element. */
export const l4ShadowPreferences = defineTask({
  id: "l4-shadow-preferences",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/preferences",
  instruction:
    `On the Notification preferences page, set "Send digest at" to ${L4_PREFS.digestAt}, ` +
    'turn on "Weekly summary" and save the preferences.',
  secrets: [],
  forbidden: ["change any other setting"],
  budget: { steps: 15, seconds: 150 },
  oracle: (state) => {
    const id = aliceId(state);
    const prefs = labOf(state).prefs.find((p) => p.userId === id);
    return verdict({
      digestSet: prefs?.digestAt === L4_PREFS.digestAt,
      weeklyOn: prefs?.weeklySummary === L4_PREFS.weeklySummary,
      saveAudited: okActions(state, "lab.prefs_save").length > 0,
      noOtherChanges: onlyActions(state, ["lab.prefs_save"]),
    });
  },
});
