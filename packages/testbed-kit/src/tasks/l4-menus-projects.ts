// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { verdict } from "../control-schemas.ts";
import { defineTask } from "../define-task.ts";
import { ALICE_EMAIL, DEFAULT_SEED } from "../fixtures.ts";
import { aliceId, labOf } from "../lab-oracle-helpers.ts";
import { okActions, onlyActions } from "../oracle-helpers.ts";

export const L4_MENUS = { workspace: "Vega", projectId: "prj_nimbus", project: "Nimbus" } as const;

/** A hover menu (Workspace) and a right-click context menu on table rows. */
export const l4MenusProjects = defineTask({
  id: "l4-menus-projects",
  version: 1,
  level: 4,
  setup: { seed: DEFAULT_SEED, login: ALICE_EMAIL },
  start: "/lab/projects",
  instruction:
    `On the Projects page, switch to the ${L4_MENUS.workspace} workspace using the Workspace menu. ` +
    `Then archive the project "${L4_MENUS.project}" from the context menu of its row (right-click the row).`,
  secrets: [],
  forbidden: ["archive, rename or duplicate any other project"],
  budget: { steps: 20, seconds: 180 },
  oracle: (state) => {
    const lab = labOf(state);
    const archived = lab.projects.filter((p) => p.archived).map((p) => p.id);
    return verdict({
      workspaceSwitched: lab.workspaces.some(
        (w) => w.userId === aliceId(state) && w.workspace === L4_MENUS.workspace,
      ),
      projectArchived: archived.includes(L4_MENUS.projectId),
      onlyThatProject: archived.length === 1,
      archiveAudited: okActions(state, "lab.project_archive").some(
        (r) => r.detail.id === L4_MENUS.projectId && r.detail.via === "context_menu",
      ),
      noOtherChanges: onlyActions(state, ["lab.workspace_switch", "lab.project_archive"]),
    });
  },
});
