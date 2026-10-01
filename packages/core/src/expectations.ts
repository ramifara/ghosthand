// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Compiles plain-language expectations ("the URL is /profile", 'text "Saved" is visible') into
// deterministic predicates. Anything that does not compile becomes a model-checked predicate.
import type { DoneWhen, Predicate } from "@ghosthand/protocol";

export interface CompiledExpectation {
  predicate: Predicate;
  /** True for "is not visible", "no error", ...: the predicate must NOT hold. */
  negated: boolean;
  source: string;
}

const Q = String.raw`["“'\`]([^"”'\`]+)["”'\`]`;
const ROLES = [
  "button",
  "link",
  "heading",
  "textbox",
  "checkbox",
  "radio",
  "tab",
  "dialog",
  "alert",
  "menuitem",
  "combobox",
  "listbox",
  "option",
  "row",
  "cell",
  "img",
  "status",
];
const ROLE_ALIASES: Record<string, string> = {
  field: "textbox",
  input: "textbox",
  "text field": "textbox",
  "text box": "textbox",
  dropdown: "combobox",
  select: "combobox",
  image: "img",
  title: "heading",
  toast: "status",
  message: "status",
  modal: "dialog",
};

const roleOf = (word: string): string | undefined => {
  const w = word.toLowerCase().trim();
  return ROLES.includes(w) ? w : ROLE_ALIASES[w];
};

type Rule = { re: RegExp; build: (m: RegExpMatchArray) => Omit<CompiledExpectation, "source"> | undefined };

const ROLE_WORDS = [...ROLES, ...Object.keys(ROLE_ALIASES)].sort((a, b) => b.length - a.length).join("|");
const NOT = String.raw`(?:is\s+not|isn't|is\s+no\s+longer|does\s+not\s+appear|doesn't\s+appear|disappears|is\s+hidden|is\s+gone)`;
const IS_VISIBLE = String.raw`(?:is\s+(?:visible|shown|displayed|present)|appears|shows(?:\s+up)?)`;

const rules: Rule[] = [
  // URL
  {
    re: /^(?:the\s+)?(?:url|address|page\s+url)\s+(?:is|equals|becomes|matches|should\s+be)\s+(\S+)$/i,
    build: (m) => ({ predicate: { kind: "url", matches: unquote(m[1] ?? "") }, negated: false }),
  },
  {
    re: /^(?:the\s+)?(?:url|address)\s+contains\s+(\S+)$/i,
    build: (m) => ({
      predicate: { kind: "url", matches: `/${escapeRe(unquote(m[1] ?? ""))}/` },
      negated: false,
    }),
  },
  {
    re: /^(?:the\s+)?(?:user\s+)?(?:is\s+)?(?:on|lands\s+on|navigates\s+to|redirected\s+to|goes\s+to)\s+(?:the\s+)?(?:page\s+)?(\/\S*|https?:\/\/\S+)$/i,
    build: (m) => ({ predicate: { kind: "url", matches: m[1] ?? "/" }, negated: false }),
  },
  // Field value
  {
    re: new RegExp(
      String.raw`^(?:the\s+)?(?:field|input|textbox|text\s+field)\s+${Q}\s+(?:has\s+(?:the\s+)?value|equals|is\s+set\s+to|contains|shows)\s+${Q}$`,
      "i",
    ),
    build: (m) => ({ predicate: { kind: "value", name: m[1] ?? "", value: m[2] ?? "" }, negated: false }),
  },
  {
    re: new RegExp(String.raw`^(?:the\s+)?(?:field|input|textbox)\s+${Q}\s+is\s+(empty|filled)$`, "i"),
    build: (m) => ({
      predicate: {
        kind: "value",
        name: m[1] ?? "",
        value: m[2]?.toLowerCase() === "empty" ? "<empty>" : "<filled>",
      },
      negated: false,
    }),
  },
  // Role + name visible / not visible
  {
    re: new RegExp(
      String.raw`^(?:an?\s+|the\s+)?(${ROLE_WORDS})\s+(?:named\s+|called\s+|labell?ed\s+)?${Q}\s+${NOT}(?:\s+(?:visible|shown|displayed|present))?$`,
      "i",
    ),
    build: (m) => roleVisible(m[1], m[2], true),
  },
  {
    re: new RegExp(
      String.raw`^(?:an?\s+|the\s+)?(${ROLE_WORDS})\s+(?:named\s+|called\s+|labell?ed\s+)?${Q}\s+${IS_VISIBLE}$`,
      "i",
    ),
    build: (m) => roleVisible(m[1], m[2], false),
  },
  {
    re: new RegExp(
      String.raw`^(?:the\s+page\s+)?(?:shows|has|displays|contains)\s+(?:an?\s+|the\s+)?(${ROLE_WORDS})\s+(?:named\s+|called\s+)?${Q}$`,
      "i",
    ),
    build: (m) => roleVisible(m[1], m[2], false),
  },
  // Text
  {
    re: new RegExp(
      String.raw`^(?:the\s+)?(?:text|message|words?)?\s*${Q}\s+${NOT}(?:\s+(?:visible|shown|displayed|present))?$`,
      "i",
    ),
    build: (m) => ({ predicate: { kind: "text", text: m[1] ?? "" }, negated: true }),
  },
  {
    re: new RegExp(
      String.raw`^(?:the\s+)?(?:text|message|words?)?\s*${Q}\s+${IS_VISIBLE}(?:\s+on\s+the\s+page)?$`,
      "i",
    ),
    build: (m) => ({ predicate: { kind: "text", text: m[1] ?? "" }, negated: false }),
  },
  {
    re: new RegExp(
      String.raw`^(?:the\s+page\s+|it\s+|user\s+)?(?:shows|displays|contains|says|sees?)\s+(?:the\s+)?(?:text\s+|message\s+)?${Q}$`,
      "i",
    ),
    build: (m) => ({ predicate: { kind: "text", text: m[1] ?? "" }, negated: false }),
  },
  {
    re: new RegExp(
      String.raw`^(?:there\s+is\s+)?no\s+(?:text\s+|message\s+)?${Q}(?:\s+(?:on\s+the\s+page|anywhere))?$`,
      "i",
    ),
    build: (m) => ({ predicate: { kind: "text", text: m[1] ?? "" }, negated: true }),
  },
  // HTTP / API checks
  {
    re: /^(?:api\s+)?(GET|HEAD)\s+(\S+)\s+(?:returns|responds\s+with|is)\s+(\d{3})$/i,
    build: (m) => ({
      predicate: {
        kind: "http",
        method: (m[1]?.toUpperCase() as "GET" | "HEAD") ?? "GET",
        url: m[2] ?? "",
        status: Number(m[3]),
      },
      negated: false,
    }),
  },
  {
    re: /^(?:api\s+)?GET\s+(\S+)\s+has\s+([\w.[\]]+)\s*(?:=|==|equals|is)\s*(.+)$/i,
    build: (m) => ({
      predicate: {
        kind: "http",
        method: "GET",
        url: m[1] ?? "",
        path: m[2] ?? "",
        equals: literal(m[3] ?? ""),
      },
      negated: false,
    }),
  },
  // Testbed oracle
  {
    re: /^oracle\s+([\w.@-]+)\s+(?:passes|holds|is\s+true)$/i,
    build: (m) => ({ predicate: { kind: "oracle", taskId: m[1] ?? "" }, negated: false }),
  },
];

function roleVisible(
  roleWord: string | undefined,
  name: string | undefined,
  negated: boolean,
): Omit<CompiledExpectation, "source"> | undefined {
  const role = roleOf(roleWord ?? "");
  if (!role || !name) return undefined;
  return { predicate: { kind: "visible", role, name }, negated };
}

const unquote = (s: string): string => s.replace(/^["“'`]|["”'`.]$/g, "");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function literal(raw: string): string | number | boolean | null {
  const t = raw.trim().replace(/\.$/, "");
  if (/^["“'`].*["”'`]$/.test(t)) return t.slice(1, -1);
  if (t === "true" || t === "false") return t === "true";
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export function compileExpectation(text: string): CompiledExpectation {
  const source = text.trim().replace(/\s+/g, " ").replace(/[.;]$/, "");
  for (const rule of rules) {
    const m = source.match(rule.re);
    if (!m) continue;
    const built = rule.build(m);
    if (built) return { ...built, source };
  }
  return { predicate: { kind: "model", criteria: source }, negated: false, source };
}

/** Builds a DoneWhen from expectation strings; negated deterministic ones go to `none`. */
export function compileDoneWhen(expectations: string[]): DoneWhen {
  const all: Predicate[] = [];
  const none: Predicate[] = [];
  for (const e of expectations.map(compileExpectation)) {
    if (e.negated && e.predicate.kind !== "model") none.push(e.predicate);
    else if (e.negated) all.push({ kind: "model", criteria: e.source });
    else all.push(e.predicate);
  }
  return { all, none };
}

export const isDeterministic = (p: Predicate): boolean => p.kind !== "model";
