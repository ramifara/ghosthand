// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";
import { Rect } from "./geometry.ts";

/** Coarse role buckets used for ranking and operation offers. */
export const RoleClass = z.enum([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "select",
  "option",
  "menuitem",
  "tab",
  "slider",
  "text",
  "heading",
  "image",
  "container",
  "other",
]);
export type RoleClass = z.infer<typeof RoleClass>;

export const ElementState = z.enum([
  "disabled",
  "checked",
  "unchecked",
  "mixed",
  "selected",
  "expanded",
  "collapsed",
  "pressed",
  "focused",
  "required",
  "invalid",
  "readonly",
  "hidden",
  "offscreen",
]);
export type ElementState = z.infer<typeof ElementState>;

/** Operations an element supports; the decision model is offered only these. */
export const ElementAction = z.enum([
  "press",
  "set_value",
  "toggle",
  "select_option",
  "focus",
  "scroll_into_view",
]);
export type ElementAction = z.infer<typeof ElementAction>;

export const Region = z.enum(["dialog", "main", "nav", "header", "footer", "aside", "form", "other"]);
export type Region = z.infer<typeof Region>;

/** How far the bounds can be trusted for pointer actions. */
export const BoundsTrust = z.enum(["exact", "approximate", "none"]);
export type BoundsTrust = z.infer<typeof BoundsTrust>;

/** Code-assigned risk of acting on the element (before any model judgement). */
export const ElementRisk = z.enum(["safe", "navigates", "submits", "destructive", "external", "unknown"]);
export type ElementRisk = z.infer<typeof ElementRisk>;

/**
 * Redacted element value. One of the literals "<empty>" and "<filled>", a secret placeholder "[input:NAME]",
 * or the visible text.
 */
export const ElementValue = z.string();
export type ElementValue = z.infer<typeof ElementValue>;

export const SECRET_PLACEHOLDER = /^\[input:[A-Za-z0-9_.-]+\]$/;

export const Element = z.object({
  /** Valid only for the snapshot it came from (e.g. a Playwright aria-ref such as "e12"). */
  token: z.string().min(1),
  /** Fingerprint that survives re-renders; used by replay. */
  stableId: z.string().min(1),
  /** ARIA role vocabulary. */
  role: z.string().min(1),
  roleClass: RoleClass,
  /** Platform role (HTML tag, UIA ControlType, AX role). */
  nativeRole: z.string(),
  name: z.string(),
  description: z.string().optional(),
  value: ElementValue.optional(),
  states: z.array(ElementState),
  actions: z.array(ElementAction),
  bounds: Rect.nullable(),
  visibleBounds: Rect.nullable(),
  boundsTrust: BoundsTrust,
  /** data-testid, UIA AutomationId or similar. */
  automationId: z.string().optional(),
  /** Nearby row/card/form/dialog text that disambiguates similar elements. */
  context: z.string().optional(),
  href: z.string().optional(),
  /** Option labels for selects/listboxes (up to the driver's cap, 1024 on the web), with the total count. */
  options: z.array(z.string()).optional(),
  optionCount: z.number().int().nonnegative().optional(),
  region: Region,
  /** Frame path; "main" for the top document. */
  frame: z.string(),
  risk: ElementRisk,
});
export type Element = z.infer<typeof Element>;
