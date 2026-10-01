// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Every released testbed task. Released tasks are frozen: behavior changes bump `version`.
import type { TestbedTask } from "./define-task.ts";
import { l1FormValidation } from "./tasks/l1-form-validation.ts";
import { l1Login } from "./tasks/l1-login.ts";
import { l1LoginWrongPassword } from "./tasks/l1-login-wrong-password.ts";
import { l1UpdateProfile } from "./tasks/l1-update-profile.ts";
import { l2OrdersDeleteRow } from "./tasks/l2-orders-delete-row.ts";
import { l2OrdersDrawerNote } from "./tasks/l2-orders-drawer-note.ts";
import { l2OrdersEditStatus } from "./tasks/l2-orders-edit-status.ts";
import { l2OrdersFilterBulk } from "./tasks/l2-orders-filter-bulk.ts";
import { l2OrdersSortFind } from "./tasks/l2-orders-sort-find.ts";
import { l2ToastUndo } from "./tasks/l2-toast-undo.ts";
import { l3AccordionTooltip } from "./tasks/l3-accordion-tooltip.ts";
import { l3AssignCustomerCombobox } from "./tasks/l3-assign-customer-combobox.ts";
import { l3DateRangeReport } from "./tasks/l3-date-range-report.ts";
import { l3RichTextBio } from "./tasks/l3-rich-text-bio.ts";
import { l3SettingsTabsSlider } from "./tasks/l3-settings-tabs-slider.ts";
import { l3TagsMultiselect } from "./tasks/l3-tags-multiselect.ts";

export const tasks: readonly TestbedTask[] = Object.freeze([
  l1Login,
  l1LoginWrongPassword,
  l1UpdateProfile,
  l1FormValidation,
  l2OrdersDeleteRow,
  l2OrdersEditStatus,
  l2OrdersSortFind,
  l2OrdersFilterBulk,
  l2OrdersDrawerNote,
  l2ToastUndo,
  l3AssignCustomerCombobox,
  l3TagsMultiselect,
  l3DateRangeReport,
  l3SettingsTabsSlider,
  l3RichTextBio,
  l3AccordionTooltip,
]);

const byId = new Map(tasks.map((t) => [t.id, t]));
if (byId.size !== tasks.length) throw new Error("duplicate task id in the testbed registry");

export function getTask(id: string): TestbedTask | undefined {
  return byId.get(id);
}

export function listTaskIds(): string[] {
  return tasks.map((t) => t.id);
}
