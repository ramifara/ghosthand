// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Expectation kinds the QA judge adds on top of core's compiler. They are deterministic and judged on the
// snapshot captured when the step ended (or from the driver's error log), never by a model.
import type { ElementState, Snapshot, VerifyState } from "@ghosthand/protocol";

export type QaCheck =
  | { kind: "title"; text: string; exact: boolean }
  | { kind: "count"; role: string; n: number; op: "eq" | "gte" }
  | { kind: "state"; role?: string; name: string; state: ElementStateWord }
  | { kind: "console_errors" }
  | { kind: "server_errors" };

export type ElementStateWord = "disabled" | "enabled" | "checked" | "unchecked" | "expanded" | "collapsed";

export interface ErrorLog {
  consoleErrors: readonly string[];
  httpErrors: ReadonlyArray<{ status: number; url: string }>;
}

const Q = String.raw`["“'\`]([^"”'\`]+)["”'\`]`;
const PLURAL: Record<string, string> = {
  rows: "row",
  row: "row",
  buttons: "button",
  button: "button",
  links: "link",
  link: "link",
  checkboxes: "checkbox",
  checkbox: "checkbox",
  items: "listitem",
  item: "listitem",
  options: "option",
  option: "option",
  tabs: "tab",
  tab: "tab",
  headings: "heading",
  heading: "heading",
  cells: "cell",
  cell: "cell",
};
const ROLE_WORD = String.raw`(button|link|checkbox|radio|tab|switch|combobox|textbox|field|menuitem|option|row)`;

/** Parses a QA-only expectation; undefined means "not one of ours" (core compiles it instead). */
export function parseQaCheck(text: string): { check: QaCheck; negated: boolean } | undefined {
  const s = text.trim().replace(/\s+/g, " ").replace(/[.;]$/, "");
  let m = /^(?:the\s+)?(?:page|document|tab)\s+title\s+(is|equals|contains)\s+(.+)$/i.exec(s);
  if (m)
    return {
      check: { kind: "title", text: unquote(m[2] ?? ""), exact: m[1] !== "contains" },
      negated: false,
    };
  m =
    /^(exactly\s+|at\s+least\s+)?(\d+)\s+([a-z]+)\s+(?:are\s+|is\s+)?(?:visible|shown|listed|displayed)$/i.exec(
      s,
    );
  if (m) {
    const role = PLURAL[(m[3] ?? "").toLowerCase()];
    if (role)
      return {
        check: { kind: "count", role, n: Number(m[2]), op: /least/i.test(m[1] ?? "") ? "gte" : "eq" },
        negated: false,
      };
  }
  m = new RegExp(
    String.raw`^(?:the\s+)?(?:${ROLE_WORD}\s+)?${Q}(?:\s+${ROLE_WORD})?\s+is\s+(not\s+)?(disabled|enabled|checked|unchecked|expanded|collapsed)$`,
    "i",
  ).exec(s);
  if (m) {
    const roleWord = (m[1] ?? m[3])?.toLowerCase();
    const role = roleWord === "field" ? "textbox" : roleWord;
    return {
      check: {
        kind: "state",
        ...(role ? { role } : {}),
        name: m[2] ?? "",
        state: (m[5] ?? "").toLowerCase() as ElementStateWord,
      },
      negated: m[4] !== undefined,
    };
  }
  if (/^(?:there\s+are\s+)?no\s+(?:javascript\s+|js\s+)?console\s+errors?(?:\s+are\s+logged)?$/i.test(s))
    return { check: { kind: "console_errors" }, negated: false };
  if (/^(?:there\s+are\s+)?no\s+(?:server\s+errors?|5xx(?:\s+responses?)?|failed\s+api\s+calls?)$/i.test(s))
    return { check: { kind: "server_errors" }, negated: false };
  return undefined;
}

const unquote = (s: string): string => s.trim().replace(/^["“'`]|["”'`]$/g, "");
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export interface QaCheckResult {
  state: VerifyState;
  detail: string;
}

export function evaluateQaCheck(
  check: QaCheck,
  snapshot: Snapshot | undefined,
  errors: ErrorLog | undefined,
): QaCheckResult {
  switch (check.kind) {
    case "console_errors": {
      if (!errors) return { state: "unknown", detail: "no console log captured" };
      const n = errors.consoleErrors.length;
      return {
        state: n === 0 ? "satisfied" : "unsatisfied",
        detail:
          n === 0 ? "no console errors" : `${n} console error(s): ${errors.consoleErrors[0]?.slice(0, 120)}`,
      };
    }
    case "server_errors": {
      if (!errors) return { state: "unknown", detail: "no network log captured" };
      const bad = errors.httpErrors.filter((e) => e.status >= 500);
      return {
        state: bad.length === 0 ? "satisfied" : "unsatisfied",
        detail:
          bad.length === 0 ? "no 5xx responses" : `${bad.length} 5xx response(s), first ${bad[0]?.status}`,
      };
    }
    default:
      break;
  }
  if (!snapshot) return { state: "unknown", detail: "no snapshot captured" };
  switch (check.kind) {
    case "title": {
      const ok = check.exact
        ? norm(snapshot.title) === norm(check.text)
        : norm(snapshot.title).includes(norm(check.text));
      return { state: ok ? "satisfied" : "unsatisfied", detail: `title "${snapshot.title}"` };
    }
    case "count": {
      const n = snapshot.elements.filter((e) => e.role === check.role && !e.states.includes("hidden")).length;
      const ok = check.op === "eq" ? n === check.n : n >= check.n;
      return { state: ok ? "satisfied" : "unsatisfied", detail: `${n} ${check.role} element(s)` };
    }
    case "state": {
      const el = snapshot.elements.find(
        (e) => norm(e.name) === norm(check.name) && (check.role === undefined || e.role === check.role),
      );
      if (!el) return { state: "unsatisfied", detail: `no element named "${check.name}"` };
      const has = (s: ElementState) => el.states.includes(s);
      const holds =
        check.state === "disabled"
          ? has("disabled")
          : check.state === "enabled"
            ? !has("disabled")
            : check.state === "checked"
              ? has("checked")
              : check.state === "unchecked"
                ? !has("checked")
                : check.state === "expanded"
                  ? has("expanded")
                  : !has("expanded");
      return {
        state: holds ? "satisfied" : "unsatisfied",
        detail: `${el.role} "${el.name}" states [${el.states.join(", ")}]`,
      };
    }
    default:
      return { state: "unknown", detail: "unsupported check" };
  }
}
