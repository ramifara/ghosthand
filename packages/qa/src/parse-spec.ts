// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Markdown QA spec → typed QaSpec. Format (Playwright Test Agents style, see apps/testbed/specs/README.md):
//
//   ---                                   front-matter (url, seed/testbed, login, budget, runs, ...)
//   # Suite: Profile                      one or more suites
//   ## Case: Update the job title         one or more cases per suite
//   1. **perform** Change ... then save.  numbered steps; "**perform**" is optional
//      **expect** text "Saved" is visible indented expect lines belong to the step
//      > a note                           notes are kept for the report, never executed
//   **expect** oracle l1-x passes         unindented expect lines are case-level, judged after the last step
import { err, ok, type Result } from "@ghosthand/protocol";
import { parseFrontMatter } from "./front-matter.ts";
import {
  MAX_STEPS_PER_CASE,
  type QaCase,
  type QaExpect,
  QaFrontMatter,
  QaSpec,
  type QaStep,
  type QaSuite,
  type SpecError,
  type SpecIssue,
} from "./spec-schema.ts";

const SUITE = /^#\s+(?:suite:\s*)?(.+?)\s*#*$/i;
const CASE = /^##\s+(?:case:\s*)?(.+?)\s*#*$/i;
const DEEPER_HEADING = /^#{3,}\s/;
const STEP = /^(\d+)[.)]\s+(.*)$/;
const PERFORM = /^\*\*perform\*\*:?\s*(.*)$/i;
const EXPECT = /^(?:[-*]\s+)?(?:\*\*expect\*\*:?|expect:)\s*(.*)$/i;
const INLINE_EXPECT = /\s+\*\*expect\*\*:?\s*/i;
const NOTE = /^>\s?(.*)$/;

interface Draft {
  suite?: QaSuite | undefined;
  case?: QaCase | undefined;
  step?: QaStep | undefined;
}

export function parseSpec(markdown: string, path?: string): Result<QaSpec, SpecError> {
  const issues: SpecIssue[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  let fm: Record<string, unknown> = {};
  let fmLines: Record<string, number> = {};
  // License headers (HTML comments) and blank lines may precede the front-matter.
  while (
    start < lines.length &&
    (lines[start]?.trim() === "" || /^<!--.*-->$/.test(lines[start]?.trim() ?? ""))
  )
    start++;
  const open = start;

  if (lines[open]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > open && l.trim() === "---");
    if (end < 0) issues.push({ line: open + 1, message: 'front-matter starts with "---" but never ends' });
    else {
      const parsed = parseFrontMatter(lines.slice(open + 1, end).join("\n"), open + 2);
      if (!parsed.ok) issues.push(...parsed.error);
      else {
        fm = parsed.value.values;
        fmLines = parsed.value.lines;
      }
      start = end + 1;
    }
  } else
    issues.push({ line: 1, message: "a spec starts with front-matter between --- lines (at least `url:`)" });

  const suites: QaSuite[] = [];
  const d: Draft = {};
  const closeStep = () => {
    if (d.step && d.case) d.case.steps.push(d.step);
    d.step = undefined;
  };
  const closeCase = () => {
    closeStep();
    if (d.case && d.suite) {
      if (d.case.steps.length === 0)
        issues.push({ line: d.case.line, message: `case "${d.case.title}" has no numbered steps` });
      if (d.case.steps.length > MAX_STEPS_PER_CASE)
        issues.push({
          line: d.case.line,
          message: `case "${d.case.title}" has ${d.case.steps.length} steps; split it (max ${MAX_STEPS_PER_CASE})`,
        });
      d.suite.cases.push(d.case);
    }
    d.case = undefined;
  };
  const closeSuite = () => {
    closeCase();
    if (d.suite) {
      if (d.suite.cases.length === 0)
        issues.push({ line: d.suite.line, message: `suite "${d.suite.title}" has no "## Case" sections` });
      suites.push(d.suite);
    }
    d.suite = undefined;
  };

  for (let i = start; i < lines.length; i++) {
    const no = i + 1;
    const raw = lines[i] ?? "";
    if (raw.trim() === "" || /^<!--.*-->$/.test(raw.trim())) continue;
    const indented = /^\s{2,}/.test(raw) || /^\t/.test(raw);
    const text = raw.trim();

    if (!indented && text.startsWith("#")) {
      if (DEEPER_HEADING.test(text)) {
        issues.push({ line: no, message: 'only "# Suite" and "## Case" headings are allowed' });
        continue;
      }
      const c = CASE.exec(text);
      if (c) {
        if (!d.suite) {
          issues.push({ line: no, message: 'a "## Case" needs a "# Suite" heading above it' });
          continue;
        }
        closeCase();
        d.case = { title: c[1] ?? "", line: no, steps: [], expects: [], notes: [] };
        continue;
      }
      const s = SUITE.exec(text);
      if (s) {
        closeSuite();
        d.suite = { title: s[1] ?? "", line: no, cases: [], notes: [] };
        continue;
      }
    }

    const note = NOTE.exec(text);
    if (note) {
      const body = (note[1] ?? "").trim();
      if (d.step && indented) d.step.notes.push(body);
      else if (d.case) d.case.notes.push(body);
      else if (d.suite) d.suite.notes.push(body);
      continue;
    }

    const step = !indented ? STEP.exec(text) : null;
    if (step) {
      if (!d.case) {
        issues.push({ line: no, message: 'a numbered step must be inside a "## Case"' });
        continue;
      }
      closeStep();
      const n = Number(step[1]);
      const expected = d.case.steps.length + 1;
      if (n !== expected) issues.push({ line: no, message: `step numbered ${n}, expected ${expected}` });
      let body = (step[2] ?? "").trim();
      const expects: QaExpect[] = [];
      const split = body.split(INLINE_EXPECT);
      if (split.length > 1) {
        body = split[0] ?? "";
        for (const e of split.slice(1)) if (e.trim()) expects.push({ text: clean(e), line: no });
      }
      const perform = PERFORM.exec(body);
      const performText = clean(perform ? (perform[1] ?? "") : body);
      if (!performText) issues.push({ line: no, message: "step has no perform text" });
      d.step = { index: expected, line: no, perform: performText || "-", expects, notes: [] };
      continue;
    }

    const expect = EXPECT.exec(text);
    if (expect) {
      const body = clean(expect[1] ?? "");
      if (!body) {
        issues.push({ line: no, message: "empty expect line" });
        continue;
      }
      if (d.step && indented) d.step.expects.push({ text: body, line: no });
      else if (d.case) {
        closeStep();
        d.case.expects.push({ text: body, line: no });
      } else issues.push({ line: no, message: "an expect line must be inside a case" });
      continue;
    }

    if (d.step && indented) {
      issues.push({
        line: no,
        message: `inside step ${d.step.index}, expected "**expect** ..." or "> note", got "${text.slice(0, 60)}"`,
      });
      continue;
    }
    // Free prose is kept as notes (Playwright plans carry an overview paragraph).
    if (d.case) {
      closeStep();
      d.case.notes.push(text);
    } else if (d.suite) d.suite.notes.push(text);
    else issues.push({ line: no, message: 'text before the first "# Suite" heading' });
  }
  closeSuite();
  if (suites.length === 0 && !issues.some((x) => x.message.includes("Suite")))
    issues.push({ line: start + 1, message: 'no "# Suite" heading found' });

  const front = QaFrontMatter.safeParse(fm);
  if (!front.success) {
    for (const issue of front.error.issues) {
      const key = String(issue.path[0] ?? "");
      const path = issue.path.join(".");
      const message =
        issue.code === "unrecognized_keys"
          ? `unknown front-matter key(s): ${issue.keys.join(", ")}`
          : `front-matter ${path || "(root)"}: ${issue.message}`;
      const line =
        issue.code === "unrecognized_keys" ? (fmLines[issue.keys[0] ?? ""] ?? 2) : (fmLines[key] ?? 2);
      issues.push({ line, message });
    }
  }
  if (issues.length > 0 || !front.success) {
    issues.sort((a, b) => a.line - b.line);
    return err({ kind: "invalid_spec", message: formatIssues(issues, path), issues });
  }
  const spec = QaSpec.safeParse({ ...(path ? { path } : {}), frontMatter: front.data, suites });
  if (!spec.success)
    return err({
      kind: "invalid_spec",
      message: spec.error.message,
      issues: [{ line: 1, message: spec.error.message }],
    });
  return ok(spec.data);
}

const clean = (s: string): string => s.trim().replace(/\s+/g, " ");

export function formatIssues(issues: SpecIssue[], path?: string): string {
  return issues.map((i) => `${path ?? "spec"}:${i.line}: ${i.message}`).join("\n");
}

/** Every case in the spec, with its suite, in document order. */
export function listCases(spec: QaSpec): Array<{ suite: QaSuite; case: QaCase; id: string }> {
  const out: Array<{ suite: QaSuite; case: QaCase; id: string }> = [];
  const used = new Set<string>();
  for (const suite of spec.suites)
    for (const c of suite.cases) {
      let id = slug(`${suite.title}-${c.title}`);
      for (let n = 2; used.has(id); n++) id = `${slug(`${suite.title}-${c.title}`)}-${n}`;
      used.add(id);
      out.push({ suite, case: c, id });
    }
  return out;
}

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "case";
