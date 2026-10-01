// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Every released testbed task. Released tasks are frozen: behavior changes bump `version`.
import type { TestbedTask } from "./define-task.ts";
import { l1FormValidation } from "./tasks/l1-form-validation.ts";
import { l1Login } from "./tasks/l1-login.ts";
import { l1LoginWrongPassword } from "./tasks/l1-login-wrong-password.ts";
import { l1UpdateProfile } from "./tasks/l1-update-profile.ts";
import { l2BigPageSelect } from "./tasks/l2-big-page-select.ts";
import { l2InjectionReviews } from "./tasks/l2-injection-reviews.ts";
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
import { l4CanvasChart } from "./tasks/l4-canvas-chart.ts";
import { l4ClosedShadowPromo } from "./tasks/l4-closed-shadow-promo.ts";
import { l4DndChecklist } from "./tasks/l4-dnd-checklist.ts";
import { l4IframeCheckout } from "./tasks/l4-iframe-checkout.ts";
import { l4InfiniteFeed } from "./tasks/l4-infinite-feed.ts";
import { l4KanbanMove } from "./tasks/l4-kanban-move.ts";
import { l4MenusProjects } from "./tasks/l4-menus-projects.ts";
import { l4ShadowPreferences } from "./tasks/l4-shadow-preferences.ts";
import { l4UploadContacts } from "./tasks/l4-upload-contacts.ts";
import { l4VirtualInventory } from "./tasks/l4-virtual-inventory.ts";
import { l5EmailCode } from "./tasks/l5-email-code.ts";
import { l5MagicLink } from "./tasks/l5-magic-link.ts";
import { l5PasswordReset } from "./tasks/l5-password-reset.ts";
import { l5SessionExpiry } from "./tasks/l5-session-expiry.ts";
import { l5SsoIdp } from "./tasks/l5-sso-idp.ts";
import { l5TotpLogin } from "./tasks/l5-totp-login.ts";
import { l6DarkZoomSettings } from "./tasks/l6-dark-zoom-settings.ts";
import { l6DynamicIds } from "./tasks/l6-dynamic-ids.ts";
import { l6FlakyPreferences } from "./tasks/l6-flaky-preferences.ts";
import { l6IconToggleVision } from "./tasks/l6-icon-toggle-vision.ts";
import { l6LayoutShift } from "./tasks/l6-layout-shift.ts";
import { l6PoorA11y } from "./tasks/l6-poor-a11y.ts";
import { l6PopupsProfile } from "./tasks/l6-popups-profile.ts";
import { l6RtlLocale } from "./tasks/l6-rtl-locale.ts";

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
  l2BigPageSelect,
  l2InjectionReviews,
  l3AssignCustomerCombobox,
  l3TagsMultiselect,
  l3DateRangeReport,
  l3SettingsTabsSlider,
  l3RichTextBio,
  l3AccordionTooltip,
  l4IframeCheckout,
  l4ShadowPreferences,
  l4ClosedShadowPromo,
  l4CanvasChart,
  l4DndChecklist,
  l4KanbanMove,
  l4UploadContacts,
  l4InfiniteFeed,
  l4VirtualInventory,
  l4MenusProjects,
  l5TotpLogin,
  l5MagicLink,
  l5EmailCode,
  l5PasswordReset,
  l5SessionExpiry,
  l5SsoIdp,
  l6FlakyPreferences,
  l6PopupsProfile,
  l6LayoutShift,
  l6DynamicIds,
  l6PoorA11y,
  l6IconToggleVision,
  l6RtlLocale,
  l6DarkZoomSettings,
]);

const byId = new Map(tasks.map((t) => [t.id, t]));
if (byId.size !== tasks.length) throw new Error("duplicate task id in the testbed registry");

export function getTask(id: string): TestbedTask | undefined {
  return byId.get(id);
}

export function listTaskIds(): string[] {
  return tasks.map((t) => t.id);
}
