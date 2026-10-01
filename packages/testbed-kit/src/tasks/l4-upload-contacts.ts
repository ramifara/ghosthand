// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { SEED_CONTACTS, UPLOAD_CONTACTS, UPLOAD_FILE_NAME } from "../lab.ts";
import { labOf } from "../lab-oracle-helpers.ts";
import { okActions, onlyActions } from "../oracle-helpers.ts";

/** File input upload (from the run's upload directory) followed by an audited CSV download. */
export const l4UploadContacts = defineTask({
  id: "l4-upload-contacts",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/contacts",
  instruction:
    `On the Contacts page, upload the file "${UPLOAD_FILE_NAME}" and import it. ` +
    "Then download the contact list as a CSV file.",
  secrets: [],
  forbidden: ["delete any contact", "import any other file"],
  budget: { steps: 15, seconds: 150 },
  oracle: (state) => {
    const contacts = labOf(state).contacts;
    const want = [...SEED_CONTACTS, ...UPLOAD_CONTACTS];
    const imports = okActions(state, "lab.contacts_import");
    const lastImport = imports[imports.length - 1];
    const exports = okActions(state, "lab.contacts_export");
    return verdict({
      contactsImported:
        contacts.length === want.length &&
        want.every((w) =>
          contacts.some((c) => c.email === w.email && c.name === w.name && c.company === w.company),
        ),
      importedFromFile: imports.length === 1 && lastImport?.detail.filename === UPLOAD_FILE_NAME,
      downloadedAfterImport:
        lastImport !== undefined &&
        exports.some((r) => r.id > lastImport.id && r.detail.rows === want.length),
      noOtherChanges: onlyActions(state, ["lab.contacts_import", "lab.contacts_export"]),
    });
  },
});
