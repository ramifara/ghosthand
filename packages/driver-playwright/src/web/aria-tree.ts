// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Parses Playwright's AI-mode aria snapshot (`page.ariaSnapshotJSON({mode: "ai", boxes: true})`, the
// JSON form of `page.ariaSnapshot({mode: "ai"})`) into a flat list of ref'd nodes plus the page text.
// Refs look like `e12` in the top document and `f1e3` inside frames; `aria-ref=<ref>` locators resolve
// them against the latest snapshot of their frame.
import { z } from "zod";

const Box = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

interface AriaNodeJson {
  role: string;
  name?: string | undefined;
  checked?: boolean | "mixed" | undefined;
  disabled?: boolean | undefined;
  expanded?: boolean | undefined;
  active?: boolean | undefined;
  invalid?: boolean | string | undefined;
  level?: number | undefined;
  pressed?: boolean | "mixed" | undefined;
  selected?: boolean | undefined;
  ariaHidden?: boolean | undefined;
  ref?: string | undefined;
  cursor?: string | undefined;
  box?: z.infer<typeof Box> | undefined;
  url?: string | undefined;
  placeholder?: string | undefined;
  text?: string | undefined;
  children?: Array<string | AriaNodeJson> | undefined;
}

const AriaNodeSchema: z.ZodType<AriaNodeJson> = z.lazy(() =>
  z.object({
    role: z.string(),
    name: z.string().optional(),
    checked: z.union([z.boolean(), z.literal("mixed")]).optional(),
    disabled: z.boolean().optional(),
    expanded: z.boolean().optional(),
    active: z.boolean().optional(),
    invalid: z.union([z.boolean(), z.string()]).optional(),
    level: z.number().optional(),
    pressed: z.union([z.boolean(), z.literal("mixed")]).optional(),
    selected: z.boolean().optional(),
    ariaHidden: z.boolean().optional(),
    ref: z.string().optional(),
    cursor: z.string().optional(),
    box: Box.optional(),
    url: z.string().optional(),
    placeholder: z.string().optional(),
    text: z.string().optional(),
    children: z.array(z.union([z.string(), AriaNodeSchema])).optional(),
  }),
);

export const AriaSnapshotSchema = z.array(z.union([z.string(), AriaNodeSchema]));

/** Roles a user acts on. Elements with these roles always enter the element table. */
export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "treeitem",
]);

/** Non-interactive roles kept as context rows (the core shows headings and text next to candidates). */
const CONTEXT_ROLES = new Set(["heading", "alert", "status"]);

/** Roles whose value Playwright renders as the node's text; that text must never be used as page text. */
const VALUE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);

/** Roles whose accessible name comes from their content; an empty name is rebuilt from their text. */
const NAME_FROM_CONTENT = new Set([
  "button",
  "link",
  "option",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "heading",
  "generic",
  "cell",
  "switch",
  "checkbox",
  "radio",
]);

export interface FlatNode {
  ref: string;
  role: string;
  name: string;
  /** Frame the node lives in: "" for the top document, else the ref of the iframe hosting it. */
  frameKey: string;
  /** Refs of ref'd ancestors, nearest last. */
  ancestors: string[];
  checked?: boolean | "mixed";
  disabled: boolean;
  expanded: boolean;
  active: boolean;
  invalid: boolean;
  pressed?: boolean | "mixed";
  selected: boolean;
  level?: number;
  pointer: boolean;
  url?: string;
  placeholder?: string;
  box?: { x: number; y: number; width: number; height: number };
  /** Option names from aria children (native selects render options without refs). */
  optionNames: string[];
}

export interface FlatTree {
  /** Elements for the table, in document order. */
  nodes: FlatNode[];
  /** Every ref'd iframe with the key of the frame it sits in. Frame keys are iframe refs (or "" for the top). */
  iframes: Array<{ ref: string; frameKey: string }>;
  /** Readable text outside interactive elements, one fragment per line. */
  text: string;
}

// Ref prefixes ("f1") follow Playwright's frame sequence, which changes on navigation, so frames are
// identified by the iframe that hosts them instead.
const REF = /^(f\d+)?e\d+$/;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

function contentText(node: AriaNodeJson, depth = 0): string {
  if (VALUE_ROLES.has(node.role) || node.ariaHidden || depth > 6) return "";
  const parts: string[] = [];
  if (node.text) parts.push(node.text);
  for (const c of node.children ?? []) {
    if (typeof c === "string") parts.push(c);
    else if (c.name && !VALUE_ROLES.has(c.role)) parts.push(c.name);
    else parts.push(contentText(c, depth + 1));
  }
  return collapse(parts.join(" "));
}

/**
 * Extra refs to keep although their role is not interactive (found by the in-page engine from markup):
 * "item" for things acted on directly (drag sources, rows with a context menu; their text becomes their
 * name), "zone" for containers that only take drops (their children stay separate elements).
 */
export type ExtraRefs = ReadonlyMap<string, "item" | "zone">;

/** Flattens a parsed AI snapshot. Text of value roles (textbox values, passwords) is never collected. */
export function flattenAriaSnapshot(
  snapshot: z.infer<typeof AriaSnapshotSchema>,
  extra: ExtraRefs = new Map(),
): FlatTree {
  const nodes: FlatNode[] = [];
  const iframes: FlatTree["iframes"] = [];
  const text: string[] = [];

  const visit = (
    item: string | AriaNodeJson,
    ancestors: string[],
    iframeRef: string | undefined,
    insideElement: boolean,
  ): void => {
    if (typeof item === "string") {
      if (!insideElement) {
        const t = collapse(item);
        if (t) text.push(t);
      }
      return;
    }
    const node = item;
    if (node.ariaHidden) return;
    const ref = node.ref !== undefined && REF.test(node.ref) ? node.ref : undefined;
    if (node.role === "iframe") {
      if (ref) iframes.push({ ref, frameKey: iframeRef ?? "" });
      const next = ref ? [...ancestors, ref] : ancestors;
      for (const c of node.children ?? []) visit(c, next, ref ?? iframeRef, false);
      return;
    }

    const interactive = INTERACTIVE_ROLES.has(node.role);
    const pointer = node.cursor === "pointer";
    const marked = ref !== undefined ? extra.get(ref) : undefined;
    const include =
      ref !== undefined &&
      (interactive ||
        marked !== undefined ||
        CONTEXT_ROLES.has(node.role) ||
        (pointer && !insideElement && node.role !== "img"));
    const isElement = include && (interactive || pointer || marked === "item");

    if (ref !== undefined && include) {
      let name = collapse(node.name ?? "");
      if (!name && (NAME_FROM_CONTENT.has(node.role) || marked === "item"))
        name = contentText(node).slice(0, 200);
      const flat: FlatNode = {
        ref,
        role: node.role,
        name,
        frameKey: iframeRef ?? "",
        ancestors,
        disabled: node.disabled === true,
        expanded: node.expanded === true,
        active: node.active === true,
        invalid: node.invalid !== undefined && node.invalid !== false,
        selected: node.selected === true,
        pointer,
        optionNames: [],
      };
      if (node.checked !== undefined) flat.checked = node.checked;
      if (node.pressed !== undefined) flat.pressed = node.pressed;
      if (node.level !== undefined) flat.level = node.level;
      if (node.url !== undefined) flat.url = node.url;
      if (node.placeholder !== undefined) flat.placeholder = node.placeholder;
      if (node.box !== undefined) flat.box = node.box;
      if (node.role === "combobox" || node.role === "listbox") {
        for (const c of node.children ?? [])
          if (typeof c !== "string" && c.role === "option" && c.name) flat.optionNames.push(collapse(c.name));
      }
      nodes.push(flat);
    }

    if (!insideElement && !interactive && !VALUE_ROLES.has(node.role)) {
      const hasChildren = (node.children ?? []).length > 0;
      if (node.name && (!hasChildren || CONTEXT_ROLES.has(node.role))) text.push(collapse(node.name));
      if (node.text && !((pointer || marked === "item") && include)) text.push(collapse(node.text));
    }
    if (VALUE_ROLES.has(node.role)) return;
    const next = ref ? [...ancestors, ref] : ancestors;
    const headingWithName = CONTEXT_ROLES.has(node.role) && Boolean(node.name);
    for (const c of node.children ?? [])
      visit(c, next, iframeRef, insideElement || isElement || headingWithName);
  };

  for (const item of snapshot) visit(item, [], undefined, false);
  return { nodes, iframes, text: text.filter((t) => t.length > 0).join("\n") };
}
