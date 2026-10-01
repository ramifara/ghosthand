// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// ARIA role inference from a JSX tag (HTML or common shadcn/Radix component names) and its attributes.

const TAG_ROLES: Record<string, string> = {
  button: "button",
  Button: "button",
  IconButton: "button",
  a: "link",
  Link: "link",
  NavLink: "link",
  textarea: "textbox",
  Textarea: "textbox",
  select: "combobox",
  NativeSelect: "combobox",
  Select: "combobox",
  SelectTrigger: "combobox",
  Combobox: "combobox",
  option: "option",
  SelectItem: "option",
  Checkbox: "checkbox",
  Switch: "switch",
  Slider: "slider",
  RadioGroup: "radiogroup",
  RadioGroupItem: "radio",
  TabsList: "tablist",
  TabsTrigger: "tab",
  TabsContent: "tabpanel",
  AccordionTrigger: "button",
  DropdownMenuItem: "menuitem",
  MenuItem: "menuitem",
  CardTitle: "heading",
  DialogTitle: "heading",
  AlertDialogTitle: "heading",
  SheetTitle: "heading",
  DialogContent: "dialog",
  AlertDialogContent: "alertdialog",
  AlertDialogAction: "button",
  AlertDialogCancel: "button",
  Alert: "alert",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  form: "form",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  img: "img",
  dialog: "dialog",
  progress: "progressbar",
  output: "status",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};

const INPUT_TYPE_ROLES: Record<string, string> = {
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  submit: "button",
  button: "button",
  reset: "button",
  image: "button",
};

export type RoleAttrs = { role?: string | undefined; type?: string | undefined; href?: boolean };

export function inferRole(tag: string, attrs: RoleAttrs): string | undefined {
  if (attrs.role) return attrs.role;
  const base = tag.includes(".") ? (tag.split(".").pop() ?? tag) : tag;
  if (base === "input" || base === "Input") {
    if (attrs.type === "hidden") return undefined;
    return INPUT_TYPE_ROLES[attrs.type ?? ""] ?? "textbox";
  }
  if (base === "a" && !attrs.href) return undefined;
  return TAG_ROLES[base];
}

/** Roles whose accessible name comes from content text. */
export const NAME_FROM_CONTENT = new Set([
  "button",
  "link",
  "heading",
  "tab",
  "option",
  "menuitem",
  "checkbox",
  "radio",
  "switch",
  "cell",
  "columnheader",
  "treeitem",
]);

export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "option",
  "menuitem",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "textbox",
  "searchbox",
  "spinbutton",
  "combobox",
]);

export const FIELD_ROLES = new Set([
  "textbox",
  "searchbox",
  "spinbutton",
  "combobox",
  "checkbox",
  "radio",
  "radiogroup",
  "switch",
  "slider",
]);

/** Tags whose content text is worth recording even without other identifiers. */
export const TEXT_TAGS = new Set([
  "button",
  "Button",
  "a",
  "Link",
  "NavLink",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "CardTitle",
  "DialogTitle",
  "AlertDialogTitle",
  "label",
  "Label",
  "TabsTrigger",
  "AccordionTrigger",
  "DropdownMenuItem",
  "AlertDialogAction",
  "AlertDialogCancel",
]);

export const LABEL_TAGS = new Set(["label", "Label", "FormLabel"]);
