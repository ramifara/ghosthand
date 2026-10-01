<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# QA specs

`ghosthand test <spec.md>` runs a spec and writes a scored, single-file HTML report plus JSON.
The format follows Playwright Test Agents plans (suites, cases, steps, expected results), with one
`**perform**` line per step and `**expect**` lines that compile to checks. The parser is
`packages/qa/src/parse-spec.ts`.

```markdown
---
url: http://127.0.0.1:4400/profile   # start URL for every case (required)
testbed:                             # optional: reset the testbed before each case run
  seed: 42                           #   or `task: l1-update-profile` to reuse a task's setup
  variant:                           #   variant flags; `--variant bug=profile-title` overrides
    a11y: good
login: alice@testbed.local           # optional: sign this user in before each case (testbed)
secrets: [TESTBED_PASSWORD]          # names the agent may type as [input:NAME]
budget:                              # per case
  steps: 12
  seconds: 90
  usd: 0.1
runs: 1                              # runs per case, for pass^k
planted_bugs:                        # bug flag → the case that must catch it
  profile-title: Update display name and job title
---

# Suite: Profile

## Case: Update display name and job title

1. **perform** Change the Display name to "Alice Moreau" and the Job title to "Staff Engineer", then save.
   **expect** text "Profile saved." is visible
   **expect** field "Job title" has value "Staff Engineer"
   > Notes are kept for the report and never executed.

**expect** oracle l1-update-profile passes
```

- Indented `**expect**` lines belong to the step above; unindented ones are case checks judged after the
  last step. A step may also be written `1. Click "Save"` (the `**perform**` marker is optional).
- Inline lists and maps in the front-matter use `[a, b]`; nested maps use two-space indentation.
- Expectations compile in this order: QA checks (`the page title is "X"`, `3 rows are visible`,
  `the "Save" button is disabled`, `no console errors`, `no server errors`), core's deterministic
  predicates (URL, text, role + name visible, field value, `GET /api/x returns 200`, `oracle <task> passes`),
  and anything else becomes a model-checked claim (Jev `holds`, then the vision reviewer).
- Write expectations about the change a step makes. The loop checks a step's expectations before acting,
  so an expectation that already holds marks the step done without performing it.

Each case runs as one agent run whose plan has one subgoal per step. Before that, one Jev request per case
classifies every step (`ok`, `transient`, `derived`, `visual`, `external`) and counts the elements it names.
`visual` steps are judged by the vision reviewer; `transient`, `derived` and `external` steps run but are
advisory.
