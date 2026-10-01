// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A Playwright selector engine registered with `contentScript: true`, so it runs in the same isolated
// world as Playwright's injected script. There it can read the `_ariaRef` expando that
// `ariaSnapshot({mode: "ai"})` leaves on each element, which maps refs to DOM nodes without touching the
// page. The selector body is a base64url-encoded command; the engine answers by returning one detached
// carrier element whose text is the JSON result, read back with `locator.textContent()`.
// Everything below runs in the browser and must stay self-contained (it is serialized with toString()).

import type {
  DomInfo,
  EngineCommand,
  EnrichResult,
  PageRect,
  PageRegion,
  PageState,
  SectionInfo,
} from "./page-types.ts";

interface SelectorEngine {
  queryAll(root: Node, body: string): Element[];
}

export function createGhosthandEngine(): SelectorEngine {
  type RefElement = Element & { _ariaRef?: { ref?: string } };
  const MAX_OPTIONS = 1024;
  const MAX_SECTION_TEXT = 6000;
  const MAX_CONTEXT = 160;
  const state = { installed: false, mutations: 0, lastMutation: 0 };

  const collapse = (s: string): string =>
    s
      .replace(/\s*\t\s*/g, " · ")
      .replace(/\s+/g, " ")
      .trim();
  const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const parentOf = (node: Node): Element | null => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };

  const closestComposed = (el: Element, selector: string): Element | null => {
    let cur: Element | null = el;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = parentOf(cur);
    }
    return null;
  };

  const containsComposed = (outer: Element, inner: Element): boolean => {
    let cur: Element | null = inner;
    while (cur) {
      if (cur === outer) return true;
      cur = parentOf(cur);
    }
    return false;
  };

  const textOf = (el: Element | null): string => {
    if (!el) return "";
    const text = el instanceof HTMLElement ? el.innerText : (el.textContent ?? "");
    return collapse(text ?? "");
  };

  const labelledBy = (el: Element): string => {
    const ids = el.getAttribute("aria-labelledby");
    if (!ids) return "";
    const doc = el.ownerDocument;
    return collapse(
      ids
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
  };

  const nameOfContainer = (el: Element): string => {
    const label = el.getAttribute("aria-label");
    if (label) return collapse(label);
    const by = labelledBy(el);
    if (by) return by;
    const legend = el.querySelector(":scope > legend");
    if (legend) return textOf(legend);
    const heading = el.querySelector("h1, h2, h3, h4, h5, h6, [role=heading]");
    return heading ? textOf(heading) : "";
  };

  const isDialog = (el: Element): boolean =>
    el.matches("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]");

  const regionOf = (el: Element): PageRegion => {
    let nearest: PageRegion | undefined;
    let cur: Element | null = el;
    while (cur) {
      if (isDialog(cur)) return "dialog";
      if (nearest === undefined) {
        const tag = cur.localName;
        const role = cur.getAttribute("role");
        if (tag === "main" || role === "main") nearest = "main";
        else if (tag === "nav" || role === "navigation") nearest = "nav";
        else if (tag === "aside" || role === "complementary") nearest = "aside";
        else if (tag === "footer" || role === "contentinfo") nearest = "footer";
        else if (tag === "header" || role === "banner") nearest = "header";
        else if (tag === "form" || role === "form" || role === "search") nearest = "form";
      }
      cur = parentOf(cur);
    }
    return nearest ?? "other";
  };

  // Regions for narrowing: open dialogs, forms, named sections and landmarks. The nearest one wins.
  const SECTION_SELECTOR =
    "dialog, [role=dialog], [role=alertdialog], form, [role=form], [role=search], section, [role=region], " +
    "main, [role=main], nav, [role=navigation], aside, [role=complementary], header, [role=banner], " +
    "footer, [role=contentinfo]";
  const KIND_LABEL: Record<SectionInfo["kind"], string> = {
    dialog: "Dialog",
    main: "Main content",
    section: "Section",
    form: "Form",
    nav: "Navigation",
    header: "Page header",
    footer: "Page footer",
    aside: "Sidebar",
    other: "Rest of the page",
  };

  const sectionKind = (el: Element): SectionInfo["kind"] | undefined => {
    if (!el.matches(SECTION_SELECTOR)) return undefined;
    const tag = el.localName;
    const role = el.getAttribute("role");
    if (isDialog(el)) return "dialog";
    if (tag === "form" || role === "form" || role === "search") return "form";
    if (tag === "section" || role === "region") return nameOfContainer(el) ? "section" : undefined;
    if (tag === "main" || role === "main") return "main";
    if (tag === "nav" || role === "navigation") return "nav";
    if (tag === "aside" || role === "complementary") return "aside";
    // header/footer are page landmarks only outside main, articles and sections.
    const parent = parentOf(el);
    if (parent && closestComposed(parent, "main, [role=main], article, section")) return undefined;
    if (tag === "header" || role === "banner") return "header";
    if (tag === "footer" || role === "contentinfo") return "footer";
    return undefined;
  };

  const slug = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

  interface SectionIndex {
    byElement: Map<Element, SectionInfo>;
    used: SectionInfo[];
  }

  /** Keys are kind + label slug, numbered in document order when repeated, so they stay stable between observations. */
  const indexSections = (doc: Document): SectionIndex => {
    const byElement = new Map<Element, SectionInfo>();
    const counts = new Map<string, number>();
    for (const el of Array.from(doc.querySelectorAll(SECTION_SELECTOR))) {
      const kind = sectionKind(el);
      if (!kind) continue;
      const label = clip(nameOfContainer(el), 80) || KIND_LABEL[kind];
      const base = `${kind}-${slug(label) || kind}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      byElement.set(el, { key: n > 1 ? `${base}-${n}` : base, kind, label });
    }
    return { byElement, used: [] };
  };

  const OTHER_SECTION: SectionInfo = { key: "page", kind: "other", label: KIND_LABEL.other };

  const sectionOf = (el: Element, index: SectionIndex): SectionInfo => {
    let cur = parentOf(el);
    while (cur) {
      const found = index.byElement.get(cur);
      if (found) return found;
      cur = parentOf(cur);
    }
    return OTHER_SECTION;
  };

  const CARD = /(^|[\s_-])(card|tile|item|product|result|entry|listing)([\s_-]|$)/i;

  const contextOf = (el: Element): string | undefined => {
    let cur = parentOf(el);
    for (let depth = 0; cur && depth < 14; depth++, cur = parentOf(cur)) {
      const tag = cur.localName;
      const role = cur.getAttribute("role");
      if (tag === "tr" || role === "row") return clip(textOf(cur), MAX_CONTEXT) || undefined;
      if (tag === "li" || role === "listitem" || tag === "article" || role === "article")
        return clip(textOf(cur), MAX_CONTEXT) || undefined;
      if (typeof cur.className === "string" && CARD.test(cur.className) && cur.children.length > 1)
        return clip(textOf(cur), MAX_CONTEXT) || undefined;
      if (tag === "fieldset" || role === "group" || role === "radiogroup") {
        const name = nameOfContainer(cur);
        if (name) return clip(name, MAX_CONTEXT);
      }
      if (isDialog(cur) || tag === "form" || role === "form" || tag === "section" || role === "region") {
        const name = nameOfContainer(cur);
        if (name) return clip(name, MAX_CONTEXT);
        if (isDialog(cur) || tag === "form") return undefined;
      }
    }
    return undefined;
  };

  const rectOf = (el: Element): PageRect => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  const deepActive = (doc: Document): Element | null => {
    let a: Element | null = doc.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a;
  };

  const isHidden = (el: Element, modal: Element | null): boolean => {
    if (closestComposed(el, "[aria-hidden=true], [inert]")) return true;
    if (modal && !containsComposed(modal, el)) return true;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true }))
      return true;
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0;
  };

  const tristate = (v: string | null): boolean | "mixed" | undefined =>
    v === "true" ? true : v === "false" ? false : v === "mixed" ? "mixed" : undefined;

  const TEXT_INPUT_EXCLUDED = new Set([
    "checkbox",
    "radio",
    "file",
    "submit",
    "button",
    "image",
    "reset",
    "hidden",
    "color",
  ]);

  const optionsOf = (el: Element): { labels: string[]; count: number } | undefined => {
    if (el instanceof HTMLSelectElement) {
      const all = Array.from(el.options);
      return { labels: all.slice(0, MAX_OPTIONS).map((o) => collapse(o.label || o.text)), count: all.length };
    }
    const role = el.getAttribute("role");
    if (role !== "listbox" && role !== "combobox") return undefined;
    let scope: Element | null = el;
    const controls = el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns");
    if (role === "combobox" && controls)
      scope = el.ownerDocument.getElementById(controls.split(/\s+/)[0] ?? "");
    if (!scope) return undefined;
    const all = Array.from(scope.querySelectorAll("[role=option]"));
    if (all.length === 0) return undefined;
    return { labels: all.slice(0, MAX_OPTIONS).map((o) => textOf(o)), count: all.length };
  };

  const describe = (el: Element, modal: Element | null, doc: Document, index: SectionIndex): DomInfo => {
    const tag = el.localName;
    const info: DomInfo = {
      tag,
      valueKind: "none",
      required: el.getAttribute("aria-required") === "true",
      disabled: false,
      readonly: el.getAttribute("aria-readonly") === "true",
      invalid: el.getAttribute("aria-invalid") === "true",
      focused: deepActive(doc) === el,
      hidden: isHidden(el, modal),
      region: regionOf(el),
      submits: false,
      rect: rectOf(el),
    };
    const testId =
      el.getAttribute("data-testid") ??
      el.getAttribute("data-test-id") ??
      el.getAttribute("data-test") ??
      el.getAttribute("data-qa") ??
      el.getAttribute("data-cy");
    if (testId) info.testId = testId;
    const nameAttr = el.getAttribute("name");
    if (nameAttr) info.fieldName = nameAttr;
    if (el.id) info.fieldId = el.id;
    const auto = el.getAttribute("autocomplete");
    if (auto) info.autocomplete = auto;

    if (closestComposed(el, "[aria-disabled=true]") || el.matches(":disabled")) info.disabled = true;
    try {
      if (el.matches(":user-invalid")) info.invalid = true;
    } catch {
      // :user-invalid is not supported everywhere.
    }

    if (el instanceof HTMLInputElement) {
      info.inputType = el.type;
      info.required = info.required || el.required;
      info.readonly = info.readonly || el.readOnly;
      if (el.type === "checkbox" || el.type === "radio") {
        info.checked = el.indeterminate ? "mixed" : el.checked;
      } else if (!TEXT_INPUT_EXCLUDED.has(el.type)) {
        info.value = el.value;
        info.valueKind = el.type === "password" ? "password" : "text";
      }
      if (el.type === "submit" || el.type === "image") info.submits = el.form !== null;
    } else if (el instanceof HTMLTextAreaElement) {
      info.required = info.required || el.required;
      info.readonly = info.readonly || el.readOnly;
      info.value = el.value;
      info.valueKind = "text";
    } else if (el instanceof HTMLSelectElement) {
      info.required = info.required || el.required;
      info.value = Array.from(el.selectedOptions)
        .map((o) => collapse(o.label || o.text))
        .join(", ");
      info.valueKind = "select";
    } else if (el instanceof HTMLButtonElement) {
      info.submits = el.type === "submit" && el.form !== null;
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      info.value = clip(collapse(el.innerText), 400);
      info.valueKind = "editable";
    }

    const ariaChecked = tristate(el.getAttribute("aria-checked"));
    if (info.checked === undefined && ariaChecked !== undefined) info.checked = ariaChecked;
    const expanded = el.getAttribute("aria-expanded");
    if (expanded === "true" || expanded === "false") info.expanded = expanded === "true";
    else if (tag === "summary" && el.parentElement instanceof HTMLDetailsElement)
      info.expanded = el.parentElement.open;
    const selected = el.getAttribute("aria-selected");
    if (selected === "true" || selected === "false") info.selected = selected === "true";
    else if (el instanceof HTMLOptionElement) info.selected = el.selected;
    const pressed = tristate(el.getAttribute("aria-pressed"));
    if (pressed !== undefined) info.pressed = pressed;

    if (el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement) {
      if (el.getAttribute("href") !== null) info.href = el.href;
    }

    const options = optionsOf(el);
    if (options) {
      info.options = options.labels;
      info.optionCount = options.count;
    }

    const described = el.getAttribute("aria-describedby");
    if (described) {
      const text = collapse(
        described
          .split(/\s+/)
          .map((id) => doc.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
      if (text) info.description = clip(text, MAX_CONTEXT);
    } else {
      const title = el.getAttribute("title");
      if (title) info.description = clip(collapse(title), MAX_CONTEXT);
    }

    const context = contextOf(el);
    if (context) info.context = context;
    const section = sectionOf(el, index);
    if (!index.used.includes(section)) index.used.push(section);
    info.section = section.key;

    if (el instanceof HTMLIFrameElement || el instanceof HTMLFrameElement) {
      const style = getComputedStyle(el);
      info.frameOffset = {
        x: info.rect.x + el.clientLeft + Number.parseFloat(style.paddingLeft || "0"),
        y: info.rect.y + el.clientTop + Number.parseFloat(style.paddingTop || "0"),
      };
      const label = el.getAttribute("title") ?? el.getAttribute("name") ?? el.getAttribute("src") ?? "";
      if (label) info.frameLabel = clip(label, 80);
    }
    return info;
  };

  const findRefs = (doc: Document, wanted: Set<string>): Map<string, Element> => {
    const found = new Map<string, Element>();
    const stack: Element[] = doc.documentElement ? [doc.documentElement] : [];
    while (stack.length > 0 && found.size < wanted.size) {
      const el = stack.pop() as RefElement;
      const ref = el._ariaRef?.ref;
      if (ref !== undefined && wanted.has(ref) && !found.has(ref)) found.set(ref, el);
      if (el.shadowRoot) for (const c of Array.from(el.shadowRoot.children)) stack.push(c);
      for (const c of Array.from(el.children)) stack.push(c);
    }
    return found;
  };

  const install = (doc: Document): void => {
    if (state.installed) return;
    state.installed = true;
    state.lastMutation = performance.now();
    const observer = new MutationObserver((records) => {
      let counted = 0;
      for (const r of records) if (!(r.type === "attributes" && r.attributeName === "style")) counted++;
      if (counted > 0) {
        state.mutations += counted;
        state.lastMutation = performance.now();
      }
    });
    observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
  };

  const BUSY =
    "[aria-busy=true], [role=progressbar]:not([aria-valuenow]), progress:not([value]), .spinner, .loader, " +
    ".loading, .is-loading, .skeleton, [data-loading=true], [data-is-loading=true], [class*=spinner]";

  const visible = (el: Element): boolean => {
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true }))
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const pageState = (doc: Document): PageState => {
    install(doc);
    let busy: string | null = null;
    for (const el of Array.from(doc.querySelectorAll(BUSY))) {
      if (!visible(el)) continue;
      const cls = typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/)[0]}` : "";
      busy = `${el.localName}${cls}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}`;
      break;
    }
    let dialogs = 0;
    for (const el of Array.from(
      doc.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]"),
    ))
      if (visible(el)) dialogs++;
    const win = doc.defaultView;
    return {
      mutations: state.mutations,
      sinceMutation: Math.round(performance.now() - state.lastMutation),
      busy,
      dialogs,
      readyState: doc.readyState,
      url: doc.location?.href ?? "",
      scrollX: win?.scrollX ?? 0,
      scrollY: win?.scrollY ?? 0,
    };
  };

  const enrich = (doc: Document, refs: string[], sectionKey?: string): EnrichResult => {
    install(doc);
    const found = findRefs(doc, new Set(refs));
    const modal = doc.querySelector("dialog:modal");
    const index = indexSections(doc);
    const items = refs.map((ref) => {
      const el = found.get(ref);
      return el ? describe(el, modal, doc, index) : null;
    });
    let sectionText: string | undefined;
    if (sectionKey !== undefined) {
      for (const [el, info] of index.byElement)
        if (info.key === sectionKey) sectionText = clip(textOf(el), MAX_SECTION_TEXT);
    }
    const win = doc.defaultView;
    return {
      sections: index.used,
      ...(sectionText !== undefined ? { sectionText } : {}),
      page: {
        url: doc.location?.href ?? "",
        innerWidth: win?.innerWidth ?? 0,
        innerHeight: win?.innerHeight ?? 0,
        scrollX: win?.scrollX ?? 0,
        scrollY: win?.scrollY ?? 0,
        devicePixelRatio: win?.devicePixelRatio ?? 1,
      },
      items,
    };
  };

  const decode = (body: string): EngineCommand => {
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as EngineCommand;
  };

  return {
    queryAll(root: Node, body: string): Element[] {
      const doc = root.ownerDocument ?? (root as Document);
      const command = decode(body);
      const result =
        command.op === "enrich" ? enrich(doc, command.refs, command.sectionText) : pageState(doc);
      const carrier = doc.createElement("ghosthand-result");
      carrier.textContent = JSON.stringify(result);
      return [carrier];
    },
  };
}
