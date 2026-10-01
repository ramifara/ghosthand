// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The `sourcemap.json` shape (general-agent-design §2.4). All paths are relative to the scanned root.
import { z } from "zod";

/** Risk pre-tag from handler names, labels and variants. "external" = sends/pays/publishes. */
export const SourceRisk = z.enum(["none", "destructive", "external"]);
export type SourceRisk = z.infer<typeof SourceRisk>;

export const SourceRoute = z.object({
  /** Full path ("/", "/settings", "/orders/:id", "/*"). */
  path: z.string().min(1),
  /** Component rendered by the route element, e.g. "SettingsPage". */
  component: z.string().optional(),
  /** File that defines `component`, when it could be resolved. */
  componentFile: z.string().optional(),
  /** Layout components of enclosing routes, outermost first (e.g. ["AppShell"]). */
  layouts: z.array(z.string()),
  index: z.boolean(),
  /** File and line of the route definition. */
  file: z.string(),
  line: z.number().int().positive(),
});
export type SourceRoute = z.infer<typeof SourceRoute>;

export const SourceElement = z.object({
  /** Exact data-testid. */
  testid: z.string().optional(),
  /** Testid from a template literal, dynamic parts as `*` (e.g. "orders.row.*"). */
  testidPattern: z.string().optional(),
  role: z.string().optional(),
  /** Approximate accessible name: aria-label, labelledby, label, content text, placeholder or title. */
  name: z.string().optional(),
  ariaLabel: z.string().optional(),
  /** Static content text; for `a ? "x" : "y"` the last branch (usually the idle state). */
  text: z.string().optional(),
  /** All static content-text alternatives when there are several. */
  texts: z.array(z.string()).optional(),
  /** Content text with dynamic parts as `*` (e.g. "Signed in as *"). */
  textPattern: z.string().optional(),
  /** Text of the label associated by htmlFor/id or by wrapping. */
  label: z.string().optional(),
  placeholder: z.string().optional(),
  /** The `id` attribute. */
  domId: z.string().optional(),
  /** The `name` attribute. */
  fieldName: z.string().optional(),
  /** JSX tag as written ("Button", "input", "Dialog.Title"). */
  tag: z.string(),
  file: z.string(),
  /** JSX line; for elements expanded from a `.map` over a const array, the line of the data item. */
  line: z.number().int().positive(),
  component: z.string(),
  /** Route paths that can render this element (import-graph reachability). */
  routes: z.array(z.string()),
  risk: SourceRisk,
  /** Handler names and literals seen in on* props (for risk and planner hints). */
  handlers: z.array(z.string()).optional(),
});
export type SourceElement = z.infer<typeof SourceElement>;

export const SourceFormField = z.object({
  tag: z.string(),
  role: z.string().optional(),
  fieldName: z.string().optional(),
  domId: z.string().optional(),
  label: z.string().optional(),
  type: z.string().optional(),
  required: z.boolean(),
  testid: z.string().optional(),
  placeholder: z.string().optional(),
  line: z.number().int().positive(),
});
export type SourceFormField = z.infer<typeof SourceFormField>;

export const SourceForm = z.object({
  testid: z.string().optional(),
  /** aria-label of the form, or its testid. */
  name: z.string().optional(),
  fields: z.array(SourceFormField),
  /** Text of the submit button when it is in the same JSX tree. */
  submitText: z.string().optional(),
  file: z.string(),
  line: z.number().int().positive(),
  component: z.string(),
  routes: z.array(z.string()),
});
export type SourceForm = z.infer<typeof SourceForm>;

export const SourceString = z.object({
  key: z.string(),
  /** Resolved text; absent when a `t("key")` call has no table entry. */
  text: z.string().optional(),
  locale: z.string().optional(),
  /** Table file and line of the entry. */
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  /** "file:line" of each `t("key")` call. */
  usedAt: z.array(z.string()),
});
export type SourceString = z.infer<typeof SourceString>;

export const SourceModule = z.object({
  file: z.string(),
  /** Resolved relative imports (files in the scanned root). */
  imports: z.array(z.string()),
  /** Top-level components (capitalized function declarations or arrow constants). */
  components: z.array(z.string()),
  /** Route paths that can render this module. */
  routes: z.array(z.string()),
});
export type SourceModule = z.infer<typeof SourceModule>;

export const SourceMap = z.object({
  version: z.literal(1),
  /** The scanned directory as given to the extractor. */
  root: z.string(),
  generatedAt: z.string(),
  routes: z.array(SourceRoute),
  elements: z.array(SourceElement),
  forms: z.array(SourceForm),
  strings: z.array(SourceString),
  modules: z.array(SourceModule),
  /** Files that could not be parsed, with the reason. */
  skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
});
export type SourceMap = z.infer<typeof SourceMap>;
