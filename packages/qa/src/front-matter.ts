// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A small YAML subset for spec front-matter: `key: scalar`, nested maps by indentation, `- item` lists and
// inline `[a, b]` lists. Anything else is an error with its line number. No anchors, no multi-line strings.
import { err, ok, type Result } from "@ghosthand/protocol";
import type { SpecIssue } from "./spec-schema.ts";

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  no: number;
  indent: number;
  text: string;
}

export interface FrontMatter {
  values: Record<string, YamlValue>;
  /** Line of each top-level key, for error messages. */
  lines: Record<string, number>;
}

export function parseScalar(raw: string): YamlValue {
  const t = raw.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true" || t === "false") return t === "true";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    return inner === "" ? [] : splitInline(inner).map(parseScalar);
  }
  return t;
}

function splitInline(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | undefined;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = undefined;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur.trim());
  return parts;
}

const stripComment = (s: string): string => {
  // A `#` starts a comment only after whitespace and outside quotes.
  let quote: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1] ?? ""))) return s.slice(0, i);
  }
  return s;
};

export function parseFrontMatter(text: string, firstLine = 1): Result<FrontMatter, SpecIssue[]> {
  const lines: Line[] = [];
  text.split("\n").forEach((raw, i) => {
    const body = stripComment(raw).replace(/\s+$/, "");
    if (body.trim() === "") return;
    if (/^\t/.test(body)) return;
    lines.push({ no: firstLine + i, indent: body.length - body.trimStart().length, text: body.trim() });
  });
  const issues: SpecIssue[] = [];
  for (const [i, raw] of text.split("\n").entries())
    if (/^\t/.test(raw))
      issues.push({ line: firstLine + i, message: "use spaces, not tabs, in front-matter" });
  let pos = 0;

  function block(indent: number): YamlValue {
    const first = lines[pos];
    if (!first || first.indent < indent) return null;
    if (first.text.startsWith("- ") || first.text === "-") {
      const list: YamlValue[] = [];
      while (pos < lines.length) {
        const l = lines[pos];
        if (!l || l.indent !== first.indent || !(l.text.startsWith("- ") || l.text === "-")) break;
        pos++;
        list.push(parseScalar(l.text.slice(1)));
      }
      return list;
    }
    const map: Record<string, YamlValue> = {};
    while (pos < lines.length) {
      const l = lines[pos];
      if (!l || l.indent < first.indent) break;
      if (l.indent > first.indent) {
        issues.push({ line: l.no, message: "unexpected indentation" });
        pos++;
        continue;
      }
      const m = /^("[^"]+"|'[^']+'|[^:]+?):(?:\s+(.*))?$/.exec(l.text);
      if (!m) {
        issues.push({ line: l.no, message: `expected "key: value", got "${l.text}"` });
        pos++;
        continue;
      }
      const key = String(parseScalar(m[1] ?? ""));
      pos++;
      if (key in map) issues.push({ line: l.no, message: `duplicate key "${key}"` });
      if (m[2] !== undefined && m[2].trim() !== "") map[key] = parseScalar(m[2]);
      else {
        const next = lines[pos];
        map[key] = next && next.indent > l.indent ? block(next.indent) : null;
      }
      if (indent === 0 && first.indent === 0) topLines[key] = l.no;
    }
    return map;
  }

  const topLines: Record<string, number> = {};
  const value = lines.length === 0 ? {} : block(0);
  if (lines[0] && lines[0].indent > 0)
    issues.push({ line: lines[0].no, message: "front-matter keys must start at column 1" });
  if (issues.length > 0) return err(issues);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return err([{ line: firstLine, message: "front-matter must be a map of keys" }]);
  return ok({ values: value, lines: topLines });
}
