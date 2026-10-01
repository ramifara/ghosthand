<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Planner probe (P1-03, 2026-10-01)

Machine: outpostone (CachyOS, x86_64), Node 26.4.0, codex-cli 0.159.2, signed in with ChatGPT. GhostHand read no Codex credentials.

Command: `bun run probe:planner -- --model gpt-6.1-sol` (and once without `--model`, which uses the thread default from `~/.codex/config.toml`, `gpt-5.6-sol` on this machine). Planner: `createCodexPlanner` over the app-server consultant, effort `low`, one warm session per run (the first call's latency includes `open()`, about 0.7 s). Input: a text page summary per goal (no screenshot; the testbed was not running). Output: `PlanDraft` under the strict `PLAN_DRAFT_JSON_SCHEMA` (3–12 subgoals), compiled by `toPlan` with `compileDoneWhen`.

Goals:

1. profile, start `http://127.0.0.1:4400/profile`: `On your profile, change the display name to "Alice Moreau" and the job title to "Staff Engineer", then save.`
2. login, start `http://127.0.0.1:4400/login`: `Sign in as alice@testbed.local with the stored password [input:TESTBED_PASSWORD]`

## Results (final prompt)

| Run | Model | profile | login | Valid | Deterministic predicates (profile / login) |
|---|---|---|---|---|---|
| 1 | gpt-6.1-sol | 10.0 s (incl. open) | 8.5 s | 2/2 | 67% / 100% |
| 2 | gpt-6.1-sol | 9.9 s (incl. open) | 7.5 s | 2/2 | 67% / 100% |
| 3 | thread default (gpt-5.6-sol) | 10.8 s (incl. open) | 7.2 s | 2/2 | 67% / 100% |

All six plans were valid, had 3 subgoals, marked only the save/sign-in subgoal as `commit`, and kept the password as the `[input:TESTBED_PASSWORD]` token. Plans were identical in substance across runs.

Plan for the profile goal (run 1, gpt-6.1-sol):

```
s1. Set "Display name" to "Alice Moreau".                 effects=advance         max_steps=2  seeds=["Display name"]
    done_when: field "Display name" has value "Alice Moreau"   → value "Display name" = "Alice Moreau"
s2. Set "Job title" to "Staff Engineer".                  effects=advance         max_steps=2  seeds=["Job title"]
    done_when: field "Job title" has value "Staff Engineer"    → value "Job title" = "Staff Engineer"
s3. Click "Save profile" to save the profile changes.     effects=advance,commit  max_steps=2  seeds=["Save profile"]
    done_when: A visible confirmation indicates that the profile was saved.   → model predicate
```

Plan for the login goal (run 1, gpt-6.1-sol):

```
s1. Fill "Email" with "alice@testbed.local".              effects=advance         max_steps=2  seeds=["Email"]
    done_when: field "Email" has value "alice@testbed.local"   → value "Email" = "alice@testbed.local"
s2. Fill "Password" with [input:TESTBED_PASSWORD].        effects=advance         max_steps=2  seeds=["Password"]
    done_when: field "Password" is filled                      → value "Password" = "<filled>"
s3. Click the "Sign in" button.                           effects=advance,commit  max_steps=2  seeds=["Sign in"]
    done_when: button "Sign in" is not visible                 → none: visible button "Sign in"
```

## Prompt iterations

Two earlier prompt versions exposed problems that the final prompt fixes:

- **v1** (examples only): the login plan's last check was `url is /home`, copied from the prompt's example. The testbed redirects to `/` after sign-in, so the subgoal could never finish. The password check was `field "Password" is nonempty`, which does not compile (it became a model predicate). The profile plan's `text "Profile saved." is visible` matched the testbed only because the prompt example uses the same message. Latency: profile 11.7 s, login 8.5 s.
- **v2** (added "the examples are not from this app; do not guess a URL or message you have not seen", plus `field "Password" is filled` and `button "Sign in" is not visible` examples): login became 100% deterministic and correct. But the profile save subgoal's checks were only the two field values, which already hold before Save is clicked, so the subgoal would "finish" without saving. Latency: profile 10.4 s, login 8.8 s.
- **v3** (final, added "every check must become true only through that subgoal's own actions; a commit subgoal needs a check that only holds after the commit, described in a sentence if the wording is unknown"): the save subgoal now has a model-checked confirmation predicate. That is one model check per run instead of a deterministic one, but it cannot pass before the commit.

## Takeaways

- A Codex planning turn takes 7–11 s at `low` effort, in line with the P0-05 probe (4–10 s). That suits once per task plus at most two replans, not the step loop.
- The planner can only quote messages and URLs it has seen. Success messages and post-commit URLs are not on the first screen, so commit subgoals get a model predicate unless the app map or a recipe supplies the exact text. Feeding app-map knowledge into `pageSummary` (P1 knowledge work) should turn those into deterministic checks.
- Prompt examples leak: models copy example URLs and messages. The prompt now says the examples only show phrasing.
- The 3-subgoal minimum forces small forms into one subgoal per field. That is fine for Jev, which acts on one intent at a time.
