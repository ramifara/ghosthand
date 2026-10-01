// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFrontMatter } from "./front-matter.ts";
import { listCases, parseSpec } from "./parse-spec.ts";

const SPEC = `<!-- SPDX-License-Identifier: AGPL-3.0-only -->
---
url: http://127.0.0.1:4400/profile
testbed:
  seed: 42
  variant:
    bug: profile-title
login: alice@testbed.local   # signed in by the harness
secrets: [TESTBED_PASSWORD]
budget:
  steps: 12
runs: 3
planted_bugs:
  profile-title: Update the title
---

# Suite: Profile

Overview text is kept as a note.

## Case: Update the title

1. **perform** Change the Job title to "Staff Engineer" and save.
   **expect** text "Profile saved." is visible
   **expect** field "Job title" has value "Staff Engineer"
   > saving is allowed
2. Click "Home" **expect** the URL is /home

**expect** oracle l1-update-profile passes

## Case: Second

1. **perform** Open the page.
`;

describe("parseSpec", () => {
  it("parses front-matter, suites, cases, steps, expects and notes with line numbers", () => {
    const r = parseSpec(SPEC, "profile.md");
    if (!r.ok) throw new Error(r.error.message);
    const spec = r.value;
    expect(spec.frontMatter.url).toBe("http://127.0.0.1:4400/profile");
    expect(spec.frontMatter.testbed).toEqual({ seed: 42, seeds: [], variant: { bug: "profile-title" } });
    expect(spec.frontMatter.login).toBe("alice@testbed.local");
    expect(spec.frontMatter.secrets).toEqual(["TESTBED_PASSWORD"]);
    expect(spec.frontMatter.budget).toEqual({ steps: 12, seconds: 180, usd: 0.25 });
    expect(spec.frontMatter.runs).toBe(3);
    const suite = spec.suites[0];
    expect(suite?.title).toBe("Profile");
    expect(suite?.notes).toEqual(["Overview text is kept as a note."]);
    const c = suite?.cases[0];
    expect(c?.title).toBe("Update the title");
    expect(c?.steps.map((s) => s.perform)).toEqual([
      'Change the Job title to "Staff Engineer" and save.',
      'Click "Home"',
    ]);
    expect(c?.steps[0]?.line).toBe(23);
    expect(c?.steps[0]?.expects.map((e) => [e.line, e.text])).toEqual([
      [24, 'text "Profile saved." is visible'],
      [25, 'field "Job title" has value "Staff Engineer"'],
    ]);
    expect(c?.steps[0]?.notes).toEqual(["saving is allowed"]);
    expect(c?.steps[1]?.expects.map((e) => e.text)).toEqual(["the URL is /home"]);
    expect(c?.expects.map((e) => e.text)).toEqual(["oracle l1-update-profile passes"]);
    expect(listCases(spec).map((x) => x.id)).toEqual(["profile-update-the-title", "profile-second"]);
  });

  it("reports every problem with its line", () => {
    const bad = `---
url: not a url
colour: red
---
# Suite: S
## Case: C
2. **perform** skipped one
   something odd
### Too deep
`;
    const r = parseSpec(bad, "bad.md");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const lines = r.error.issues.map((i) => i.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    const messages = r.error.issues.map((i) => `${i.line}: ${i.message}`);
    expect(messages).toContain("7: step numbered 2, expected 1");
    expect(messages.some((m) => m.startsWith('8: inside step 1, expected "**expect** ..."'))).toBe(true);
    expect(messages.some((m) => m.startsWith("9: only"))).toBe(true);
    expect(messages.some((m) => m.startsWith("3: unknown front-matter key(s): colour"))).toBe(true);
    expect(messages.some((m) => m.startsWith("2: front-matter url"))).toBe(true);
    expect(r.error.message).toContain("bad.md:7:");
  });

  it("requires front-matter and at least one suite and case", () => {
    const r = parseSpec("# Suite: S\n");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.issues[0]?.message).toMatch(/front-matter/);
      expect(r.error.issues.some((i) => /no "## Case"/.test(i.message))).toBe(true);
    }
  });

  it("parses the testbed specs in apps/testbed/specs", () => {
    for (const name of ["profile.md", "login.md", "orders.md"]) {
      const text = readFileSync(new URL(`../../../apps/testbed/specs/${name}`, import.meta.url), "utf8");
      const r = parseSpec(text, name);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.suites[0]?.cases.length).toBeGreaterThan(0);
    }
  });
});

describe("parseFrontMatter", () => {
  it("handles scalars, nested maps, block and inline lists and comments", () => {
    const r = parseFrontMatter(
      [
        "a: 1",
        "b: true",
        'c: "x # not a comment"',
        "d:",
        "  - one",
        "  - 2",
        "e: [x, 'y z']",
        "f:",
        "  g:",
        "    h: null # c",
      ].join("\n"),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.values).toEqual({
      a: 1,
      b: true,
      c: "x # not a comment",
      d: ["one", 2],
      e: ["x", "y z"],
      f: { g: { h: null } },
    });
    expect(r.value.lines).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 7, f: 8 });
  });

  it("rejects malformed lines and duplicates", () => {
    const r = parseFrontMatter("a: 1\na: 2\njust text", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((i) => i.line)).toEqual([6, 7]);
  });
});
