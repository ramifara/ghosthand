// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Shapes exchanged between Node and the in-page scripts. Node parses every in-page result with these
// schemas; the in-page code only imports the inferred types.
import { z } from "zod";

export const PageRect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type PageRect = z.infer<typeof PageRect>;

export const PageRegion = z.enum(["dialog", "main", "nav", "header", "footer", "aside", "form", "other"]);
export type PageRegion = z.infer<typeof PageRegion>;

const Tristate = z.union([z.boolean(), z.literal("mixed")]);

/** What the in-page enrichment learned about one element of the aria snapshot. */
export const DomInfo = z.object({
  tag: z.string(),
  inputType: z.string().optional(),
  /** `name`, `id` and `autocomplete` attributes, used in Node to spot sensitive fields. */
  fieldName: z.string().optional(),
  fieldId: z.string().optional(),
  autocomplete: z.string().optional(),
  testId: z.string().optional(),
  /** Absolute URL for anchors and areas. */
  href: z.string().optional(),
  /** Raw value; never leaves Node unredacted. */
  value: z.string().optional(),
  valueKind: z.enum(["none", "text", "password", "select", "editable"]),
  required: z.boolean(),
  disabled: z.boolean(),
  readonly: z.boolean(),
  checked: Tristate.optional(),
  expanded: z.boolean().optional(),
  selected: z.boolean().optional(),
  pressed: Tristate.optional(),
  invalid: z.boolean(),
  focused: z.boolean(),
  /** aria-hidden, inert, outside an open modal, CSS-invisible or zero-size. */
  hidden: z.boolean(),
  region: PageRegion,
  context: z.string().optional(),
  description: z.string().optional(),
  options: z.array(z.string()).optional(),
  optionCount: z.number().optional(),
  /** Button or input that submits a form. */
  submits: z.boolean(),
  rect: PageRect,
  /** For iframes: offset of the content box inside the parent viewport. */
  frameOffset: z.object({ x: z.number(), y: z.number() }).optional(),
  /** For iframes: title, name or src, used to build frame paths. */
  frameLabel: z.string().optional(),
});
export type DomInfo = z.infer<typeof DomInfo>;

export const PageInfo = z.object({
  url: z.string(),
  innerWidth: z.number(),
  innerHeight: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
  devicePixelRatio: z.number(),
});
export type PageInfo = z.infer<typeof PageInfo>;

export const EnrichResult = z.object({
  page: PageInfo,
  /** Same order as the requested refs; null when the ref is not found in the DOM. */
  items: z.array(DomInfo.nullable()),
});
export type EnrichResult = z.infer<typeof EnrichResult>;

/** Page-level state used by settle and by effect read-back. */
export const PageState = z.object({
  /** Mutations seen since the observer was installed (style-only changes excluded). */
  mutations: z.number(),
  /** Milliseconds since the last counted mutation (or since install). */
  sinceMutation: z.number(),
  /** Description of a visible loading indicator, or null. */
  busy: z.string().nullable(),
  /** Visible open dialogs. */
  dialogs: z.number(),
  readyState: z.string(),
  url: z.string(),
  scrollX: z.number(),
  scrollY: z.number(),
});
export type PageState = z.infer<typeof PageState>;

export type EngineCommand = { op: "enrich"; refs: string[] } | { op: "state" };

/** Before/after read-back of a single target, taken with `locator.evaluate`. */
export const TargetProbe = z.object({
  tag: z.string(),
  checked: Tristate.optional(),
  expanded: z.boolean().optional(),
  selected: z.boolean().optional(),
  pressed: Tristate.optional(),
  /** Raw value; compared in Node and never written to evidence unredacted. */
  value: z.string().optional(),
  selectedLabels: z.array(z.string()).optional(),
  focused: z.boolean(),
  hovered: z.boolean(),
  /** Hash of the nearest container's text, to spot DOM changes near the target. */
  nearHash: z.string(),
  rect: PageRect,
  inViewport: z.boolean(),
  scrollTop: z.number(),
  scrollLeft: z.number(),
});
export type TargetProbe = z.infer<typeof TargetProbe>;

export const HitTestResult = z.object({
  ok: z.boolean(),
  /** Short description of the element found at the target's center. */
  hit: z.string(),
  x: z.number(),
  y: z.number(),
});
export type HitTestResult = z.infer<typeof HitTestResult>;
