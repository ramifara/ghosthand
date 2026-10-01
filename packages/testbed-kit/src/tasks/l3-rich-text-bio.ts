// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { findUser, okActions, onlyActions, otherBiosUnchanged } from "../oracle-helpers.ts";
import { richTextPlain, richTextRuns } from "../rich-text.ts";
import { SETTINGS_MESSAGES } from "../settings.ts";

export const L3_BIO_BOLD_WORD = "fixtures";

export const l3RichTextBio = defineTask({
  id: "l3-rich-text-bio",
  version: 1,
  level: 3,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/bio",
  instruction: `In your public bio, make the word "${L3_BIO_BOLD_WORD}" bold and save. Don't change the text.`,
  secrets: [],
  forbidden: ["change the bio text", "format any other word", "edit the profile"],
  budget: { steps: 20, seconds: 150 },
  doneWhen: {
    all: [
      { kind: "text", text: SETTINGS_MESSAGES.bioSaved },
      { kind: "oracle", taskId: "l3-rich-text-bio" },
    ],
    none: [],
  },
  oracle: (state) => {
    const id = findUser(state.users, ALICE_EMAIL)?.id;
    const now = state.bios.find((b) => b.userId === id)?.html ?? "";
    const before = state.initialBios.find((b) => b.userId === id)?.html ?? "";
    const bold = richTextRuns(now, "strong");
    return verdict({
      wordBold: bold.length === 1 && bold[0] === L3_BIO_BOLD_WORD,
      textUnchanged: before !== "" && richTextPlain(now) === richTextPlain(before),
      italicsUnchanged: richTextRuns(now, "em").join("|") === richTextRuns(before, "em").join("|"),
      otherBiosUnchanged: otherBiosUnchanged(state, id),
      saveAudited: okActions(state, "bio.update").length > 0,
      noOtherChanges: onlyActions(state, ["bio.update"]),
    });
  },
});
