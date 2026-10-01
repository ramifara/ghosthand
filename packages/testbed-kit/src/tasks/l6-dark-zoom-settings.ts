// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import {
  findSettings,
  findUser,
  okActions,
  onlyActions,
  otherSettingsUnchanged,
  settingsUnchangedExcept,
} from "../oracle-helpers.ts";
import { SETTINGS_MESSAGES } from "../settings.ts";

export const L6_EMAIL_LIMIT = 30;

/** The L3 settings flow (tabs and a slider) in forced dark mode with the root font size at 150%. */
export const l6DarkZoomSettings = defineTask({
  id: "l6-dark-zoom-settings",
  version: 1,
  level: 6,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL, variant: { theme: "dark", zoom: "150" } },
  start: "/settings",
  instruction:
    `In Settings, open the Notifications tab, set the daily email limit to ${L6_EMAIL_LIMIT} ` +
    "and save the notification settings. Leave the digest as it is.",
  secrets: [],
  forbidden: ["change the digest", "change general or advanced settings", "revoke the API key"],
  budget: { steps: 20, seconds: 150 },
  doneWhen: {
    all: [
      { kind: "text", text: SETTINGS_MESSAGES.notifications },
      { kind: "oracle", taskId: "l6-dark-zoom-settings" },
    ],
    none: [],
  },
  oracle: (state) => {
    const id = findUser(state.users, ALICE_EMAIL)?.id ?? -1;
    return verdict({
      variantApplied: state.variant.theme === "dark" && state.variant.zoom === "150",
      emailLimitSet: findSettings(state.settings, id)?.emailLimit === L6_EMAIL_LIMIT,
      otherSettingsUnchanged: settingsUnchangedExcept(state, id, ["emailLimit"]),
      otherUsersUntouched: otherSettingsUnchanged(state, id),
      saveAudited: okActions(state, "settings.notifications").length > 0,
      noOtherChanges: onlyActions(state, ["settings.notifications"]),
    });
  },
});
