// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Native roles (AT-SPI, UIA, AX) → ARIA roles, role classes and the operations the chooser is offered.
// Follows the table in docs/research/notes/desktop-inspiration.md §10 and cua RFC 4268 (ideas only).
// Pitfalls handled here: AT-SPI `text` is editable only with EditableText or the `editable` state, while
// UIA `Text` is static text; GTK4/libadwaita nests a same-named label in buttons (labels are text, not elements).
import type { DesktopPlatform, ElementAction, ElementState, RoleClass, RpcNode } from "@ghosthand/protocol";

const ATSPI: Record<string, string> = {
  "push button": "button",
  button: "button",
  "push button menu": "button",
  "toggle button": "switch",
  "check box": "checkbox",
  "radio button": "radio",
  "combo box": "combobox",
  "menu item": "menuitem",
  "check menu item": "menuitemcheckbox",
  "radio menu item": "menuitemradio",
  "tearoff menu item": "menuitem",
  link: "link",
  entry: "textbox",
  "password text": "textbox",
  "spin button": "spinbutton",
  slider: "slider",
  "page tab": "tab",
  "list item": "option",
  "tree item": "treeitem",
  "table cell": "cell",
  "table row": "row",
  "column header": "columnheader",
  "row header": "rowheader",
  "table column header": "columnheader",
  "table row header": "rowheader",
  label: "StaticText",
  static: "StaticText",
  caption: "StaticText",
  paragraph: "paragraph",
  heading: "heading",
  image: "img",
  icon: "img",
  dialog: "dialog",
  alert: "alertdialog",
  "file chooser": "dialog",
  "color chooser": "dialog",
  "font chooser": "dialog",
  frame: "window",
  window: "window",
  menu: "menu",
  "menu bar": "menubar",
  "tool bar": "toolbar",
  "status bar": "status",
  notification: "status",
  "progress bar": "progressbar",
  "level bar": "meter",
  "list box": "listbox",
  list: "list",
  tree: "tree",
  table: "grid",
  "tree table": "treegrid",
  "page tab list": "tablist",
  "scroll pane": "group",
  panel: "group",
  filler: "group",
  grouping: "group",
  section: "group",
  form: "form",
  "document web": "document",
  "document frame": "document",
  "document text": "textbox",
  terminal: "textbox",
};

const UIA: Record<string, string> = {
  Button: "button",
  SplitButton: "button",
  CheckBox: "checkbox",
  RadioButton: "radio",
  ComboBox: "combobox",
  Edit: "textbox",
  Document: "document",
  Hyperlink: "link",
  MenuItem: "menuitem",
  ListItem: "option",
  TreeItem: "treeitem",
  TabItem: "tab",
  Slider: "slider",
  Spinner: "spinbutton",
  DataItem: "row",
  Text: "StaticText",
  Image: "img",
  Window: "window",
  Pane: "group",
  Group: "group",
  List: "listbox",
  Tree: "tree",
  Table: "grid",
  DataGrid: "grid",
  Menu: "menu",
  MenuBar: "menubar",
  ToolBar: "toolbar",
  StatusBar: "status",
  ProgressBar: "progressbar",
  Header: "row",
  HeaderItem: "columnheader",
  Tab: "tablist",
  TitleBar: "group",
  Calendar: "grid",
  ToolTip: "tooltip",
  Custom: "generic",
};

const AX: Record<string, string> = {
  AXButton: "button",
  AXMenuButton: "combobox",
  AXPopUpButton: "combobox",
  AXComboBox: "combobox",
  AXCheckBox: "checkbox",
  AXRadioButton: "radio",
  AXMenuItem: "menuitem",
  AXMenuBarItem: "menuitem",
  AXLink: "link",
  AXTextField: "textbox",
  AXTextArea: "textbox",
  AXSearchField: "textbox",
  AXSecureTextField: "textbox",
  AXSlider: "slider",
  AXIncrementor: "spinbutton",
  AXStepper: "spinbutton",
  AXRow: "row",
  AXCell: "cell",
  AXStaticText: "StaticText",
  AXHeading: "heading",
  AXImage: "img",
  AXWindow: "window",
  AXSheet: "dialog",
  AXDrawer: "dialog",
  AXGroup: "group",
  AXList: "listbox",
  AXOutline: "tree",
  AXTable: "grid",
  AXBrowser: "tree",
  AXMenu: "menu",
  AXMenuBar: "menubar",
  AXToolbar: "toolbar",
  AXTabGroup: "tablist",
  AXScrollArea: "group",
  AXProgressIndicator: "progressbar",
  AXBusyIndicator: "progressbar",
  AXDisclosureTriangle: "button",
  AXColorWell: "button",
  AXDateField: "textbox",
  AXWebArea: "document",
  AXSplitGroup: "group",
};

const AX_SUBROLES: Record<string, string> = {
  AXSwitch: "switch",
  AXTabButton: "tab",
  AXDialog: "dialog",
  AXSystemDialog: "dialog",
  AXSearchField: "textbox",
  AXSecureTextField: "textbox",
  AXOutlineRow: "treeitem",
  AXTableRow: "row",
};

/** ARIA role for a native node. Unknown native roles become "generic". */
export function ariaRole(platform: DesktopPlatform, node: RpcNode): string {
  const editable = isEditable(node);
  switch (platform) {
    case "linux-x11":
    case "linux-wayland": {
      if (node.role === "text") return editable ? "textbox" : "StaticText";
      return ATSPI[node.role] ?? "generic";
    }
    case "windows": {
      if (node.role === "Button" && node.interfaces.includes("Toggle")) return "switch";
      if (node.role === "Document") return editable ? "textbox" : "document";
      if (node.role === "MenuItem" && node.interfaces.includes("Toggle")) return "menuitemcheckbox";
      return UIA[node.role] ?? "generic";
    }
    case "macos": {
      const sub = node.subrole !== undefined ? AX_SUBROLES[node.subrole] : undefined;
      if (sub !== undefined) return sub;
      if (node.role === "AXRow" && node.states.includes("selectable")) return "option";
      return AX[node.role] ?? "generic";
    }
  }
}

export function isEditable(node: RpcNode): boolean {
  if (node.states.includes("read-only")) return false;
  return (
    node.interfaces.includes("EditableText") ||
    node.states.includes("editable") ||
    (node.interfaces.includes("Value") && !node.states.includes("read-only") && isTextLike(node.role))
  );
}

const isTextLike = (role: string): boolean =>
  [
    "Edit",
    "Document",
    "AXTextField",
    "AXTextArea",
    "AXSearchField",
    "AXSecureTextField",
    "AXComboBox",
  ].includes(role);

const ROLE_CLASS: Record<string, RoleClass> = {
  button: "button",
  link: "link",
  textbox: "textbox",
  searchbox: "textbox",
  spinbutton: "textbox",
  checkbox: "checkbox",
  switch: "checkbox",
  menuitemcheckbox: "checkbox",
  radio: "radio",
  menuitemradio: "radio",
  combobox: "select",
  listbox: "select",
  option: "option",
  treeitem: "option",
  row: "option",
  cell: "option",
  menuitem: "menuitem",
  tab: "tab",
  slider: "slider",
  heading: "heading",
  StaticText: "text",
  paragraph: "text",
  status: "text",
  img: "image",
  window: "container",
  dialog: "container",
  alertdialog: "container",
  group: "container",
  form: "container",
  list: "container",
  grid: "container",
  tree: "container",
  treegrid: "container",
  tablist: "container",
  menu: "container",
  menubar: "container",
  toolbar: "container",
  document: "container",
};

export function roleClassOf(role: string): RoleClass {
  return ROLE_CLASS[role] ?? "other";
}

/** Roles that are structure only; they are never offered as targets (their text may still be). */
export const CONTAINER_ROLES = new Set([
  "window",
  "dialog",
  "alertdialog",
  "group",
  "form",
  "list",
  "grid",
  "tree",
  "treegrid",
  "tablist",
  "menu",
  "menubar",
  "toolbar",
  "document",
  "generic",
  "listbox",
  "progressbar",
  "meter",
  "tooltip",
  "columnheader",
  "rowheader",
]);

/** Roles whose name is page text, not a target. */
export const TEXT_ROLES = new Set(["StaticText", "paragraph", "heading", "status"]);

const ACTIONABLE_INTERFACES = new Set([
  "Action",
  "Invoke",
  "Toggle",
  "SelectionItem",
  "ExpandCollapse",
  "AXPress",
  "AXConfirm",
  "AXPick",
]);

/** True when the host reports a way to act on the node (an action, a pattern, editability or a selection). */
export function hasNativeAction(node: RpcNode): boolean {
  return (
    node.actions.length > 0 || node.interfaces.some((i) => ACTIONABLE_INTERFACES.has(i)) || isEditable(node)
  );
}

/** Operations offered for an element. Disabled elements keep their actions; the core filters them. */
export function actionsFor(role: string, node: RpcNode): ElementAction[] {
  const base: ElementAction[] = ["focus", "scroll_into_view"];
  switch (role) {
    case "textbox":
      return node.interfaces.includes("Text") || node.interfaces.includes("TextPattern")
        ? ["set_value", "select_text", ...base]
        : ["set_value", ...base];
    case "spinbutton":
    case "slider":
      return ["set_value", ...base];
    case "combobox":
      return isEditable(node) ? ["set_value", "select_option", ...base] : ["select_option", ...base];
    case "checkbox":
    case "switch":
    case "radio":
    case "menuitemcheckbox":
    case "menuitemradio":
      return ["toggle", ...base];
    case "img":
      return hasNativeAction(node) ? ["press", ...base] : [];
    default:
      return ["press", ...base];
  }
}

/** Protocol element states from native state names (AT-SPI vocabulary; the UIA and AX hosts emit the same). */
export function statesFor(role: string, node: RpcNode): ElementState[] {
  const s = new Set(node.states);
  const out: ElementState[] = [];
  if (!s.has("enabled") && !s.has("sensitive")) out.push("disabled");
  const checkable = ["checkbox", "switch", "radio", "menuitemcheckbox", "menuitemradio"].includes(role);
  if (s.has("indeterminate") || s.has("mixed")) out.push("mixed");
  else if (s.has("checked")) out.push("checked");
  else if (checkable) out.push("unchecked");
  if (s.has("selected")) out.push("selected");
  if (s.has("expanded")) out.push("expanded");
  else if (s.has("expandable") || s.has("collapsed")) out.push("collapsed");
  if (s.has("pressed")) out.push(role === "switch" ? "checked" : "pressed");
  if (s.has("focused")) out.push("focused");
  if (s.has("required")) out.push("required");
  if (s.has("invalid-entry") || s.has("invalid")) out.push("invalid");
  if (role === "textbox" && !isEditable(node)) out.push("readonly");
  if (s.has("offscreen")) out.push("offscreen");
  return out;
}
