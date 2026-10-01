# jevCUA as a general-purpose agent: strategy router, plan-once execution, latency budgets

Date: 2026-09-30. This builds on `plan/AGENT_PLAN.md` and the notes `jev-web-repos.md`, `web-agent-inspiration.md`,
`desktop-inspiration.md` and `openrouter-jev.md`. Paths under `refs/` mean
`/home/outpostone/dev/jev-computer-use/research/refs/`. Nothing was installed or run. Web sources are listed at the end.

The problem: the user wants "give it any task and it works", with QA as one mode, and without an LLM call on every
step. The answer is to make the **mode a per-subgoal decision** that a cheap, mostly deterministic router takes, to
make the default mode one that needs no LLM per step, and to make every successful run cheaper the next time
(recipes, app maps, source maps).

---

## 0. Evidence that shapes the design

| Measurement | Number | Source |
|---|---|---|
| Jev decide on native desktop, 4-26 candidates | median 197-242 ms, p95 255-331 ms, 420/420 correct | `refs/cua/rfcs/4268-jev-use-native-candidates.md:968-975` |
| Per-turn observe / decide / act, WinUI3 | Jev 421 / 203 / 46 ms; local S1 4B chooser 422 / 4249 / 45 ms | same RFC, line 940 |
| Local S1 chooser decide | 4.5-9.3 s median (with queueing) | same table |
| OmniParser visual parse per turn | 2.1 s macOS, 4.7 s Linux, 8.1 s Windows | RFC 4268:900 |
| Visual-only alternative | "adds CPU OCR and detection latency of 2 to 9 seconds per turn" | RFC 4268:649 |
| typesafe-computer-use step on macOS | capture 0.31 + OCR 0.31 + AX 0.06 + decide 0.21 + act 0.05, total 0.95 s | `refs/typesafe-computer-use/docs/run-folder.md:18` |
| Jev vs Claude Opus 5 on one screenshot | model 0.13-0.38 s vs 5.2 s; end-to-end step about 1.5 s vs 5.5 s; about $0.0002 vs $0.032 per decision | `refs/typesafe-computer-use/README.md` |
| jev-ultrafast Google Flights | 7.07 s for the whole task, 17 Jev calls (median 178 ms), 2 text-LLM calls (346 ms and 581 ms) | `refs/browser-use-jev-ultrafast/docs/performance.md` |
| Same, time sinks | cutting browser protocol calls from 1,092 to 101 and stopping re-decides on animations saved 25% | same |
| Jev through OpenRouter | about 350-530 ms (community numbers) | `plan/AGENT_PLAN.md` |
| typesafe-computer-use on OSWorld Chrome (6 tasks, best run) | 6/6 solved, 5-10 steps, 37-73 s each, 1-4 writer calls per task | `refs/typesafe-computer-use/benchmarks/osworld/20260929T164943Z.jsonl` |
| GPT-6 Luna agent, same task 7580065a | 6 steps in 29 s (14 s model time, about 2.3 s per step), jev 42-73 s on the same task | `.../20260929T163719Z.jsonl` vs other runs |
| typesafe-computer-use "who did the work" | classifier 14 calls (82%, 3.9 s), writer 3 calls (18%, 21.4 s) | `refs/typesafe-computer-use/docs/how-a-step-works.md:240` |

**Two lessons.**

1. Model latency is not the only cost. On OSWorld a frontier agent beat the Jev agent on wall clock. OSWorld's fixed 2 s
   wait per action punishes an agent that takes more, cheaper steps (`OBSERVATIONS.md`). Also, 3 writer calls cost more
   time (21 s) than 14 classifier calls (3.9 s). Settle, observe and step count matter as much as decide time. So the
   budget has to cover **observe + settle + steps**, not just "fewer LLM calls".
2. Each LLM hand-off costs about 5-7 s. So the quantity to minimise is **LLM calls per task**, and the rate to watch is
   the **LLM share** of calls and seconds. That is typesafe-computer-use's "classifier's share is the number the design
   stands on".

---

## 1. Strategy router

### 1.1 Modes (the executor ladder)

| Mode | Per-step models | When it fits | Prior art |
|---|---|---|---|
| **A. Replay** (compiled recipe or script) | none. A guard check per step; Jev repairs a single step on a miss | Same app and flow seen before, or generated from source | Stagehand `cacheDir` and replaying an observed `Action` "without another inference call"; perixtar fingerprint replay; Playwright Test Agents specs; workflow-use ("10x faster, ~90% cheaper"); Shortest `runCachedTest` falling back on `CacheError` |
| **B. Jev-first** | 1 Jev request per step (operation + target heads + `goal_done`/`stuck`), plus a separate verify request when needed. LLM only for free text and hand-offs | Good element table (web DOM/aria, rich AX/UIA/AT-SPI), goal fits one sentence per subgoal | typesafe-computer-use, jev-ultrafast, jev-desktop, omarchy-jev |
| **C. LLM planner + Jev executor** | LLM once per task (plan) and once per failed subgoal (replan). Jev per step | Multi-part goals, unfamiliar apps with decent a11y, exploratory QA | openqa `planTask` with `done_when`; Agent S3 split of generator and grounder; cua composite `grounder+planner`; `AGENT_PLAN.md` D2(b) |
| **D1. Vision assist** (one step) | VLM describes or grounds once. Jev still chooses (screen-to-text), or the VLM returns an element id or a pixel tied to `capture_id` | A step where the table lacks the target: icon-only button, canvas region, unnamed control | tontoko `screenDecide`; cua `parse_visual_regions` + `capture_id`; Agent S3 grounding prompt |
| **D2. Vision CUA drive** (bounded segment) | Claude/OpenAI/Gemini computer-use tool drives for up to N steps | Canvas/remote-desktop/game-like UIs, apps with no a11y, repeated D1 failures | Anthropic `computer_toolset_20260801`; OpenAI Responses `computer` tool; Gemini computer use |
| **H. Human** | none | Consequential action awaiting approval, missing info, repeated failure | typesafe-computer-use `question`; OpenAI `needsApproval`; Gemini `require_confirmation` |

The router picks the **cheapest mode likely to succeed for this subgoal**, climbs one rung on a failure signal, and
drops back down as soon as the signal clears. Mode is per subgoal and can change within a task. For example, "open the
settings and export the report as PDF" might run in A on web, then B, then D2 for one canvas print dialog, then B again.

### 1.2 Router inputs (all cheap and computed in code)

- **Task profile**: from the task type (section 3) and the plan's subgoal, with `allowed_effects` and risk.
- **Knowledge level** for the current screen:
  - `recipe` (a verified recipe matches the screen fingerprint and subgoal intent);
  - `mapped` (the app map knows the screen and its elements, from runs or from source);
  - `seen` (the screen fingerprint was visited but not mapped);
  - `unknown`.
- **Surface quality score** `q` in [0,1], computed from the snapshot:
  - share of interactive elements that have a name (cooper and RFC 4268 refuse unnamed targets);
  - count of candidates (under 3 on a visibly busy screen is suspicious);
  - share of window area covered by canvas/`<canvas>`/unlabelled image regions or by one opaque AX node;
  - `snapshot.complete` / `degraded` / `truncated` flags from the driver;
  - for web, whether the target sits inside an iframe or closed shadow root.
- **History**: consecutive low-confidence decisions, stalls (screen signature unchanged), and repeats.
- **Budgets left**: LLM calls, vision steps, dollars, wall clock.

### 1.3 Initial routing table (tune from logs)

| Condition | Mode |
|---|---|
| `recipe` hit and guards pass | A |
| web or `q ≥ 0.7`, subgoal is a single intent with `done_when` | B |
| task is multi-part, or no plan exists yet | C (plan once), then B per subgoal |
| `q` between 0.4 and 0.7, or target not found once in B | B with D1 on the step that fails |
| `q < 0.4`, canvas/VNC/game, or D1 failed twice on this screen | D2 for at most N=8 steps, or until `q` recovers |
| effect of the chosen action ∉ `allowed_effects`, or provider safety flag | H |

### 1.4 Escalation triggers (climb one rung)

- A → B: a guard fails (fingerprint or locator no longer resolves uniquely, perixtar-style). Jev repairs **that step
  only** from the recipe's intent text. On success the recipe is patched; on failure, fall to B for the rest of the
  subgoal.
- B → hand-off (writer LLM gives a *focus* or asks a *question*, typesafe-computer-use style):
  - operation confidence < 0.65 or target probability < 0.7;
  - `none`/`ambiguous` chosen;
  - `stuck` noul ≥ 0.85, or 3 unchanged screens.

  A focus is one move ("Click the 'Arrives in 2-4 days' filter"). Jev resumes with it in its state. On the capture that
  stopped a run at 0.39, the same classifier then picked the filter at 0.92 (`how-a-step-works.md:216-220`).
- B → C: two hand-offs on the same subgoal without progress. The planner rewrites that subgoal (split it, add a
  navigation subgoal, or change `done_when`).
- B/C → D1: the chosen target is unnamed, or `q` is low in the region the plan points at, or verify is
  `inconclusive`.
- D1 → D2: D1 fails twice on the same screen fingerprint, or the surface is visual-only.
- Any → H:
  - a commit or irreversible effect not pre-approved;
  - a provider safety check (`pending_safety_checks`, `require_confirmation`);
  - a credential or 2FA prompt with no tool bound to it;
  - three stalls with no new page. typesafe-computer-use: "no solved run stalled more than twice".

### 1.5 De-escalation (drop back down)

- After every D2 action, the driver still produces the normal snapshot in parallel. The next step returns to B if `q`
  recovers, or if the screen fingerprint matches the app map (e.g. the canvas dialog closed).
- After a hand-off, the next step always goes back to Jev. The writer never picks clicks.
- A C-level replan is written back into the plan so later runs start at B.
- A successful D2 segment is recorded as a trajectory. If its actions can be tied to elements after the fact, the
  segment becomes a recipe (section 2.3). Otherwise it stays a "vision-only recipe" replayed with capture-bound
  coordinates plus a verify predicate (lower trust, and it never replays a commit without approval).

### 1.6 Budgets and the "LLM share" meter

Per task, from config:
- `max_llm_calls` (default 8);
- `max_vision_steps` (default 12);
- `max_cost_usd` (default $0.25; perixtar reserves bytes×price before each call);
- `deadline_s`.

Per step, a latency SLO per mode (section 4). The router logs a line per task, for example:
```
calls: jev 23 (88%, 5.1s)  llm 2 (8%, 7.9s)  vision 1 (4%, 4.4s)  replay 11 steps  wall 31.2s  cost $0.019
```
If the LLM share exceeds 20% of calls on a known app, that is a bug in state engineering or the app map, not a reason
to add more LLM calls. That is typesafe-computer-use's lesson: "the fix belongs in the state the classifier reads".

### 1.7 How others route

- **browser-use**:
  - `flash_mode` strips `evaluation_previous_goal`, `next_goal` and thinking, and turns off planning ("planning is
    structurally impossible", `browser_use/agent/service.py:239-243`).
  - It is forced on for their own fast model.
  - `max_actions_per_step=5` batches actions per LLM call (`agent/views.py:71`).
  - `use_judge=True` runs an LLM judge on the trace (`views.py:74, 288`).
  - The lesson is that the LLM is still called every step; they only make each call cheaper and multi-action.
- **Stagehand**:
  - "Plan ahead with observe": one `observe()` returns many `Action`s, and each is replayed through `act()` with no
    further inference (`refs/stagehand/packages/docs/v4/best-practices/speed-optimization.mdx`).
  - Server and local caches are keyed on instruction + page + options. Variables are keyed by name, not value.
  - A cached replay runs "with self-healing turned off. If the recorded selector no longer resolves, Stagehand falls
    back to full inference" (`caching.mdx:336`). This is our A → B rule.
- **typesafe-computer-use**: the classifier acts. The writer runs only for `type_text`, proposed URLs and stop
  hand-offs. `--handoffs 10`, three questions max, and a third stall ends the run as `stuck`.
- **cua composite agents**: `model="grounder+planner"` pairs a vision grounder with any planner LLM
  (`refs/cua/blog/composite-agents.md`). RFC 3931/4268 goes further: the client builds candidates, Jev returns one
  ID, the Driver acts, and an independent oracle checks. Visual regions (OmniParser) are the fallback, not the default.
- **Agent S3**:
  - A generator LLM emits `agent.click("the blue Submit button")`, and a separate grounding model resolves it to a
    pixel (`gui_agents/s3/agents/grounding.py`).
  - Behavior Best-of-N (bBoN) runs several rollouts and picks one: OSWorld 66% → 72.6%, WindowsAgentArena
    50.2% → 56.6% with 3 rollouts.
  - That buys accuracy with multiples of latency and cost, which suits offline benchmark runs, not interactive ones.
- **jev-desktop** (Codex plugin): a "Deterministic fast path?" branch skips Jev for known URLs or fixed sequences.
  Consequential controls "are not executed by Jev's fast loop. They return to Codex". Its measured bottleneck was
  observation, not decide.
- **Anthropic guidance** (`platform.claude.com` computer-use docs):
  - Batch actions and end each batch with a screenshot.
  - Pair the computer toolset with browser, bash and editor tools because they are "faster than GUI clicks".
  - Screenshot about 500 ms, 1024x768 to 1366x768, keep the last 3 screenshots.
  - Human approval for consequential actions; screenshots are scanned for prompt injection automatically.
- **OpenAI guidance**: `pending_safety_checks` must be returned as `acknowledged_safety_checks`. Agents SDK
  `needsApproval`/`onSafetyCheck`. Confirm anything that modifies data, sends messages or purchases.
- **Gemini guidance**: a per-action `safety_decision` of `regular | require_confirmation | blocked`, which the ToS says
  you may not bypass.

**Takeaway:** providers make each vision step safer. Only replay, observe-plan-replay (Stagehand) and classifier loops
(Jev) remove LLM calls. The router combines these.

---

## 2. Plan once, execute many steps

### 2.1 Plan format (produced by the LLM once, or compiled from a recipe or source)

```ts
type Plan = {
  goal: string;
  taskType: "do" | "extract" | "fill" | "explore" | "test" | "monitor";
  inputs: { path: string; label: string; secret?: boolean }[];   // values stay local (tontoko bind_i)
  allowedEffects: Effect[];            // read | navigate | input | commit | external | irreversible
  outputs?: JSONSchema;                // for extract/monitor
  subgoals: Subgoal[];
  budgets: { llmCalls: number; visionSteps: number; costUsd: number; deadlineS: number };
};
type Subgoal = {
  id: string;
  intent: string;                      // one sentence Jev can act on ("Open the Billing tab")
  modeHint?: "replay" | "jev" | "vision";
  recipe?: string;                     // recipe id if one matches
  expectScreen?: string;               // app-map screen id / URL pattern / window title
  seedTargets?: string[];              // stable ids or testids from the app map or source map
  doneWhen: Predicate[];               // compiled, ANDed, checked in code
  doneClaim?: string;                  // Jev `holds` noul fallback when no predicate compiles
  maxSteps: number;                    // default 6
  onFail: "handoff" | "replan" | "vision" | "human" | "skip";
  effects?: Effect[];                  // subset of allowedEffects needed here
};
type Predicate =
  | { url: string | RegExp } | { title: string }
  | { element: { testid?: string; role?: string; name?: string }; state?: "visible" | "hidden" | "enabled" | "checked"; value?: string }
  | { text: string; visible: boolean } | { count: { of: Selector; op: "=" | ">=" ; n: number } }
  | { network: { method: string; path: string; status?: number } }         // web: page.waitForResponse
  | { window: { title?: string; app?: string; exists: boolean } }           // desktop: verify_state
  | { file: { path: string; exists: boolean } } | { api: { http: HttpCheck } };
```

**Planner rules** (from openqa `policy.ts:216-267` and Playwright's planner):
- 3 to 12 subgoals.
- Each `doneWhen` names visible or checkable evidence, and deterministic predicates are preferred.
- Subgoals are independent and resumable.
- No values or secrets in the text, only input paths.
- Every commit subgoal is marked.

The planner gets the element table of the first screen, the app map summary and, when present, the source map
(section 2.4). With those, subgoal intents use real labels and testids, and seed targets are exact.

**Execution without LLM calls:**
- Each subgoal runs in mode B or A until `doneWhen` holds (checked in code after each action, with `stable_samples`
  polling like cua `verify_state`) or `maxSteps` runs out.
- Jev's `goal_done` noul is a watcher, never the verdict.
- The LLM is called again only on `onFail: replan`, for free text that no finite choice covers (openqa `text_<i>` over
  goal literals comes first), or on a hand-off.
- A 10-subgoal task therefore costs 1 plan call plus 0-3 extra calls, instead of one call per step.

**Multi-step from one observation (Stagehand's trick in Jev form):**
- For form fills, one Jev request carries `bind_<i>` heads for every unbound input path (tontoko). Code then fills all
  bound fields in sequence, re-checking freshness between mutations, with no further decide calls.
- Use the same for check-all-these-filters and for select-then-submit sequences where the plan lists the values.
- jev-desktop's `FILL_GROUP` does the same.

### 2.2 Screen fingerprints and the app map

An **app map** per app, stored in `~/.local/share/jevcua/maps/<app-id>/<version>/` with this content:
- **screens**: a fingerprint plus a name.
  - Web: URL pattern with ids templated, landmark and heading set, dialog title.
  - Desktop: app, window role and title pattern, and a hash of the top-level AX roles.
- **elements** per screen:
  - `stable_id` (RFC 4268 `role_class:slug(label)[:hash]`);
  - a locator chain in Playwright `normalize()` priority: testid → role+name → label → text
    (`selectorGenerator.ts` scores 1 / 100 / 140 / 180);
  - `source` provenance (runtime-observed, source-extracted, or both);
  - effect class and risk tags.
- **transitions**: (screen, action on stable_id) → screen, with success counts and last-seen time.
- **recipes**: see 2.3.

Uses of the map:
- Router knowledge level.
- Seed targets for the planner.
- Ranking candidates, so known-relevant elements go first when the table is capped.
- Navigation: a symbolic shortest path over transitions to reach `expectScreen`. That is Agent+P's idea (UI
  transition graph plus a symbolic planner) applied to learned and source-extracted graphs. It needs zero model calls
  when the path is known.

### 2.3 Recipes and skills learned from successful runs

Only **verified** runs produce recipes: every `doneWhen` held, and the run did not end in a hand-off loop.

```yaml
recipe: billing.export_invoice_pdf@3
app: acme-web  version: ">=2026.09"  learnedFrom: [run-2026-09-30T21-04, ...]  successes: 7  failures: 0
params: { month: {type: string, example: "2026-08"} }        # Stagehand-style variables keyed by name
pre: [{ url: "/billing" }]
steps:
  - { op: click, target: {testid: "tab-invoices", role: tab, name: "Invoices"}, guard: {context: "Billing"} }
  - { op: select, target: {role: combobox, name: "Month"}, value: "${month}" }
  - { op: click, target: {role: button, name: "Export PDF"}, effect: external }   # download, pre-approved
post: [{ file: { path: "~/Downloads/invoice-${month}.pdf", exists: true } }]
intent: "Export the invoice PDF for a given month from Billing"   # used for Jev repair and retrieval
```

- **Induction**:
  - Compress the successful trajectory: drop no-ops, waits and failed attempts, as workflow-use "filters noise from
    recordings".
  - Turn literal inputs into params, and keep durable locators.
  - Attach the pre and post predicates that actually held.
  - This follows AWM (workflows induced from past runs: +24.6% and +51.1% relative success on Mind2Web and WebArena,
    fewer steps).
  - It also follows ASI and SkillWeaver (skills as executable programs, admitted only after execution-based checks:
    ASI +23.5% over the static agent on WebArena, 10.7-15.3% fewer steps; SkillWeaver +31.8% WebArena, +39.8% on real
    sites).
- **Human-demonstrated recipes**: during human takeover (section 3.4), record the user's actions and element targets
  and induce a recipe from them. This is AgentRR's "user-recorded task demonstration" mode, which reported 80% fewer
  API calls on common tasks.
- **Retrieval** is code-first: match app, screen fingerprint and intent keywords. Only when several recipes remain,
  one Jev `choice` over recipe intents plus `none`. No embedding service is needed at first.
- **Execution**:
  - Mode A: guard each step (fingerprint + unique resolution + hit-test).
  - Jev repairs a step on a miss.
  - A failed post-predicate demotes the recipe (failure count up). After two failures the router stops using it until
    it is re-learned.
  - Recipes never auto-run `commit`/`irreversible` steps unless the task's `allowedEffects` include them.
- **Export**: web recipes compile to Playwright `.spec.ts` (Playwright Test Agents' generator shape) for QA regression
  and CI. That is AGENT_PLAN D2(c).

Plan-level caching (APC, NeurIPS 2025: -50% cost, -27% latency): keep the plan templates too. For a new task whose
intent matches a stored plan template, fill it with Jev `bind` / `choice` questions instead of calling the planner.

### 2.4 Source-code and PR-aware element maps (for apps we build)

For our own apps the UI's vocabulary is in the repo, so we extract it before the run.

**Static extractor** (TS compiler API or Babel, run in-process on the checkout; no model):
- **Elements**, from JSX/TSX/Vue/Svelte templates:
  - `data-testid` / `data-test*`, `aria-label`, `role`, `id`, `name`, `placeholder`, `htmlFor` + label text;
  - literal button, link and heading text;
  - i18n keys resolved through locale JSON (`t('billing.export')` becomes "Export PDF").
- **Forms**:
  - `<form>` / `useForm` / `register('email')` / `name=` fields;
  - zod, yup or valibot schemas give types, required and min/max. These feed negative tests and finite text
    candidates.
- **Routes**:
  - Next.js app or pages directories (Shortest's `NextJsAnalyzer` already does this with Babel:
    `refs/shortest/packages/shortest/src/core/app-analyzer/next-js-analyzer.ts`, producing
    `RouteInfo{routePath, components, hasForm, hooks, eventHandlers, featureFlags}`);
  - react-router / TanStack route objects, Vue router, SvelteKit directories;
  - API routes with their methods.
- **Component → route graph**: follow imports from each route's page file, so an element knows which routes can show
  it.
- **Handlers**: `onClick={deleteInvoice}`, where the name contains `delete|remove|pay|send|publish`, pre-tags risk.
- **Desktop apps we build**:
  - WPF/WinUI `AutomationProperties.AutomationId` / `x:Name`;
  - GTK `.ui`/Blueprint `id` + `accessible-name`;
  - SwiftUI `.accessibilityIdentifier`;
  - Electron uses the web path.
  - These join to UIA/AT-SPI/AX `automation_id` in the driver's `Element`.

**PR/diff scoping** (`git diff --name-only base...head` plus hunks):
1. Changed files → changed components → routes that reach them through the import graph. This is the "changed
   surface".
2. Elements added, removed or renamed in the diff (testid/label/i18n changes).
3. Routes added, and form schema changes.

Output `sourcemap.json`: `{routes[], elements[{testid, role, name, route[], file, line, risk, changed}], forms[],
flows[]}`, where `flows` are plan candidates.

**How it is used:**
- **Pre-seed the element table**:
  - A runtime element that matches a source element (same testid, or role + name) gets `source:{file,line,changed}`
    and moves to the top of ranking.
  - Its locator is the testid, the most durable locator (Playwright score 1).
  - Jev sees `context` enriched with the component name when useful.
- **Plan from the diff**:
  - The planner LLM gets the diff summary, the changed surface and existing specs.
  - It writes test subgoals for new or changed flows, similar to QA.tech's PR agent ("analyzes code diff to find
    user-facing changes and inspects preview deployments") and Playwright's planner with a seed test.
  - One LLM call per PR. Execution is B/A.
- **Deterministic oracles for free**:
  - "Every testid added in the diff renders on its route" and "removed testids are gone".
  - Form validation matches the schema: submit empty or invalid values and expect the error elements.
  - These are checks with zero model calls.
- **Navigation without exploration**: route URLs are known, so `goto` plus role-scoped search replaces exploratory
  clicking. Where the transition needs UI (a modal), the handler-to-component map says which button opens it.
- **Coverage report**: the share of changed elements and routes that were exercised and verified.
- **Rule**: source is a *hint* and the runtime is the truth. A testid in source that never renders is itself a finding
  (feature flag, dead code, broken render) and is reported, not silently skipped.

**Prior art:**
- Shortest (`analyze` → `plan` → `generate`, Next.js AST analysis, cached replay with UI-element-mismatch fallback).
- Playwright Test Agents (planner with seed test, generator, healer).
- AutoE2E (feature inference, 79% feature coverage).
- LLMVue (page transition graph extracted from Vue.js source to guide exploration).
- Agent+P (UI transition graph from program analysis plus a symbolic planner).
- QA.tech PR testing (diff plus preview URL; optional code access).
- Octomind is the counterexample: URL-only, no source.

None combine a source map with a cheap classifier executor. That combination is our edge for "PR under test" QA.

---

## 3. Beyond QA: one loop, many task types

### 3.1 The loop

```
task ─► classify (code rules + one Jev choice if ambiguous) ─► plan (recipe | plan template | LLM planner)
      ─► for each subgoal: router picks mode ─► execute steps (observe → decide → gate → act → settle)
      ─► doneWhen check (code) ─► next subgoal | escalate
      ─► task oracle (per type) ─► result + evidence + "who did the work" line ─► learn (recipe/map update)
```

### 3.2 Task types: what differs

| Type | Plan shape | Oracle / judge | Where Jev `score` fits | Steady-state model calls |
|---|---|---|---|---|
| **do** ("rename the project", "export PDF") | subgoals to a state change | Readback of the new state (tontoko: find the new record, ground each field, compare locally); `doneWhen` predicates | none | 0 on a recipe; 1 plan + Jev on first run |
| **extract** ("what's the cheapest fare", "list open invoices") | navigate, then read | Output validated against `outputs` schema; every value grounded to a source text id (tontoko `semantic.ts` two-stage ground → compare); provenance in the result | confidence of grounding | extraction of structured rows is code (DOM/AX tables). The LLM only for free-form summaries, from the grounded texts |
| **fill** (forms, applications) | one `bind_<i>` batch per form screen | Readback per field (perixtar); `unobserved` fields listed; submit needs `commit` approval | none | Jev bind per screen, LLM only for missing free-text answers |
| **explore / test** (QA, PR testing) | subgoals from spec or diff; plus exploration frontier | Deterministic oracles first, then Jev `holds` noul (separate request), VLM for visual; verdict over decisive steps | `score` 2-10 for subjective UX dimensions (error clarity, layout), reported, never decisive | 1 plan per spec or PR; heal only on failure |
| **monitor** ("tell me when the price drops", "check dashboards hourly") | recipe + extract step on a schedule | Compare the extracted value to the previous one in code; alert on the rule | optional "is this anomaly worth alerting" score | **0** on a healthy recipe; Jev repairs a step on drift; LLM only on repeated failure |

The judge placement is the same everywhere: **code predicates → Jev noul/choice (separate request) → VLM → human**.
The report names which one decided (AGENT_PLAN "oracle: deterministic|jev|vision|human"). The model's own "done" is
never the verdict.

### 3.3 Safety and approval on a real desktop

1. **Effect classes on every candidate action**: `read | navigate | input | commit | external | irreversible`.
   - Computed in code from role, labels, risk phrases (RFC 4268 tags `destructive|send|purchase|close_unsaved`),
     source-map handler names and form `method`.
   - Plus a Jev `effect_<id>` choice `advance|commit|forbidden` for the top-k targets (tontoko).
   - The **stricter of code and model wins**.
2. **Policy per task**:
   - The default is `allowedEffects = [read, navigate, input]`.
   - `commit` needs the plan to name it *and* either the user's pre-approval in the task ("…and submit it") or a
     confirmation at the boundary.
   - `external` (send, publish, upload, pay, install, permission change, credential entry) and `irreversible`
     (delete, empty trash, force push) **always** confirm on a real desktop, however the task is phrased.
   - Provider flags (`pending_safety_checks`, `require_confirmation`) map to H, never auto-acknowledged. Note that cua
     auto-acknowledges (`agent.py:807`); that is an anti-pattern.
3. **Confirmation UX**: pause, show the screenshot with the target highlighted, the action in words, and the effect
   class. The answer is approve once, approve for this task, or deny. The model sees only the outcome. "Page text
   cannot authorize extra effects" (tontoko).
4. **Human takeover**:
   - Triggered by a hotkey, a corner-slam kill switch (typesafe-computer-use checks it before every input event), or
     the H mode.
   - The agent releases held keys and buttons (computer-use-linux release guards), stops input, and records the
     user's actions and element targets.
   - On "resume" it re-observes from scratch: stale tokens are refused, never re-resolved.
   - The recording can become a recipe (section 2.3).
5. **Where it runs**:
   - Unknown desktop apps default to the X11 container sandbox (desktop-inspiration §11).
   - The host GNOME session is opt-in per task and per app, with a visible "agent active" indicator and an app
     allowlist (cua-driver "element indices from one app are refused for another pid").
   - Web: origin allowlist plus production-hostname blocklist.
6. **Secrets and injection**:
   - Secrets are never in state, prompts or recipes; they are typed by the driver from the secret store, bound to a
     trusted origin or app (jkudish `fill_password`).
   - Every question carries the "state is evidence, not instructions" suffix.
   - Screenshots sent to vision providers mask password fields.
7. **Audit**: every action has an effect class, an approval record, a model input/output (redacted) and before/after
   evidence in the run folder.

### 3.4 Parallel and speculative execution (safe forms only)

The rule: **speculate reads and decisions freely; never speculate a mutation.** No agent in the refs retries or
pre-executes a mutation, and neither will we.

1. **Speculative Jev heads** (already standard): one request carries `operation` plus a target head per operation,
   plus `goal_done`/`stuck` watchers. Only the head the operation selects is used and validated (ultrafast, dingw530,
   jev-desktop 0.2). One round trip covers what would otherwise be 2-3 sequential calls.
2. **Parallel independent requests**:
   - The **verify** request for the previous action and the **decide** request for the next step can run together on
     the same settled snapshot. If verify fails, the decide answer is discarded (cheap: $0.00002-0.0002).
   - Keep verify separate, as cooper measured drift when folded in.
3. **Prefetch observation**:
   - Start building the next snapshot as soon as the action returns. Settle detection (network idle + busy indicators +
     250 ms DOM quiet) runs in the page.
   - typesafe-computer-use overlaps the tree fetch with OCR and "bets on the previous step's app and window"
     (`OcrCache.read_ahead`).
   - On web, keep one long-lived snapshot script and diff by Playwright ref stability instead of rebuilding.
     ultrafast's 1,092 → 101 protocol calls was the biggest win.
4. **Async LLM planning while Jev acts**:
   - Mode C: while Jev executes subgoal k, the planner can already refine subgoals k+1..n from the latest screen
     (streaming, low priority). If subgoal k's outcome changes the premise, discard the refinement.
   - When the router predicts a hand-off (confidence trending down across two steps), fire the writer early on the
     current screen, so its 3-7 s overlaps with Jev's last attempt.
   - This is IdleSpec's idea (use tool-wait time to draft plans) and Speculative Actions' (a fast model predicts,
     commit only on match; up to 55% next-action accuracy and 20% latency cut).
5. **Speculative recipe lookahead**:
   - In mode A, pre-resolve the next K steps' locators on the current page when their targets are already present
     (form fields).
   - Pre-resolving is a read, but every action still re-checks freshness right before input.
6. **Parallel rollouts** (Agent S3 bBoN): only for offline QA exploration or benchmark runs, in separate containers,
   never on the user's desktop.
7. **Warm connections**: keep HTTP/2 keep-alive to OpenRouter and TypeSafe, and pre-open the vision session when `q`
   is low, so escalation does not pay TLS and cold-start costs.

---

## 4. Latency budget targets per step

All numbers are wall clock per agent step, excluding the app's own work (page load, server response), which is
reported separately as `settle`. "Measured" figures come from section 0; the others are targets.

| Mode | observe | decide | act | settle (typical) | Step target p50 / p95 | Model calls per step |
|---|---|---|---|---|---|---|
| **A. Replay** | 5-30 ms (locator resolve + guard + hit-test) | 0 | 20-100 ms | 50-300 ms (DOM quiet 250 ms) | **≤ 300 ms / 700 ms** | 0 (a Jev repair on a miss adds about 0.2-0.5 s) |
| **B. Jev-first, web** | 30-100 ms (single-evaluate snapshot, ultrafast style) | 180-250 ms direct TypeSafe, 350-530 ms via OpenRouter | 30-100 ms | 250-500 ms | **≤ 0.8 s / 1.5 s** (direct), ≤ 1.1 s / 1.8 s (OpenRouter) | 1 Jev (+1 verify on checkpoint steps) |
| **B. Jev-first, desktop native** | 90 ms Linux, 310-420 ms Windows (RFC 4268); +300 ms if OCR is needed | about 200-240 ms | 45 ms | 200-500 ms | **≤ 1.0 s / 1.8 s** | 1 Jev |
| **C. Planner + Jev** | as B | as B per step; plan 3-10 s once; replan 3-7 s per failed subgoal | as B | as B | amortized **≤ 1.3 s** per step over a 10-step task; first-step latency up to 10 s | Jev per step, LLM ≈ 1 + 0.2 per subgoal |
| **Hand-off (writer focus)** | as B | 1-7 s (small fast model like Mercury for text: 0.35-0.6 s; a screen-reading writer: 5-7 s) | – | – | ≤ 3 s using a fast text model on the text-only screen; ≤ 7 s with the image | 1 LLM |
| **D1. Vision assist** | +0.3-0.5 s screenshot | 1.5-4 s VLM (describe → Jev, or ground to id or `capture_id` pixel); OmniParser 2-8 s if local | 45 ms | as B | **≤ 4 s / 7 s**, at most 1 in 10 steps on known apps | 1 VLM |
| **D2. Vision CUA drive** | 0.3-0.5 s screenshot | about 2.3 s (Luna in the OSWorld run: 14 s over 6 steps) to 5.2 s (Opus 5, one screenshot) | 50-100 ms, batched | 0.5-2 s fixed waits typical | **≤ 5 s / 9 s**; segments ≤ 8 steps | 1 VLM, multi-action batches |
| **H. Human** | – | human | – | – | untimed; excluded from agent SLO | 0 |

**Per-task targets** (known web app, 10-15 steps):
- Recipe replay: under 5 s, zero model calls.
- First run in Jev-first/planner mode: 12-25 s with 1-3 LLM calls.
- Unknown desktop app with some vision: 40-90 s.

These are only competitive with a frontier CUA (about 30 s for 6 steps on OSWorld) if **step count and settle waits**
are kept down. So:
- use semantic actions (set_value, invoke, select_option) instead of click-type sequences;
- use batched binds for forms;
- use `goto` on known routes;
- use event-driven settle instead of fixed sleeps.

Put a per-step SLO alarm in the run report. When a mode's p95 exceeds its target, the report names the phase that ate
it (observe, decide, act or settle), in the format of typesafe-computer-use's `timing:` line.

---

## 5. Build order (fits AGENT_PLAN phases)

1. Phase 1 already builds B for web. Add the `Router` interface with only A/B/H and the "who did the work" meter from
   day one.
2. Record every verified run as a trajectory. Add recipe induction + mode A replay + Jev single-step repair (perixtar,
   Stagehand semantics). Add Playwright spec export.
3. Source-map extractor for TS/React/Next first (fork the idea of Shortest's analyzer, not the code), plus the diff
   scoper. Wire it into element ranking, the planner prompt and zero-model oracles. This is the QA-on-PR lane.
4. Plan format + planner (C) with `doneWhen` predicates. Add task types extract/fill/monitor on the same loop.
5. D1 (VLM screen-to-text → Jev; capture-bound grounding) and D2 (one provider adapter behind a `VisionDriver`
   interface: Anthropic `computer_toolset_20260801` first, OpenAI and Gemini later). Map provider safety flags to H.
6. Speculation: parallel verify+decide, snapshot prefetch, early writer call. Measure before and after, as ultrafast
   did with matched runs.

## 6. Open questions to measure in Phase 0/1

- Does `noul`/`score` work through the OpenRouter decisions endpoint (only `choice` is confirmed)? The verify path
  depends on it.
- Jev decide latency through OpenRouter vs direct TypeSafe from this host (the p95 matters more than p50 for the B
  target).
- Recipe hit rate on the user's own apps after N runs, and repair success rate. These decide whether A is the common
  case.
- Source-map precision: share of source testids that render at runtime on the target app (feature flags, lazy
  routes).

---

## Sources

- Agent Workflow Memory: https://arxiv.org/abs/2409.07429
- Inducing Programmatic Skills (ASI): https://arxiv.org/html/2504.06821
- SkillWeaver: https://arxiv.org/pdf/2504.07079
- AgentRR, record & replay: https://arxiv.org/abs/2505.17716
- Agentic Plan Caching: https://arxiv.org/abs/2506.14852
- Speculative Actions: https://arxiv.org/pdf/2510.04371
- IdleSpec: https://arxiv.org/abs/2605.22154
- Agent+P (UI transition graph via program analysis): https://arxiv.org/pdf/2510.06042
- LLMVue (page transition graph from Vue source): https://arxiv.org/pdf/2606.27665
- AutoE2E: https://arxiv.org/abs/2408.01894, https://github.com/parsaalian/autoe2e
- QA.tech PR testing: https://qa.tech/product/pr-testing, https://docs.qa.tech/configuration/github-app
- Octomind (URL-only discovery): https://bug0.com/knowledge-base/octomind-ai-testing-platform-features
- workflow-use: https://github.com/browser-use/workflow-use
- Anthropic computer use tool: https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/computer-use-tool
- OpenAI guardrails and approvals: https://developers.openai.com/api/docs/guides/agents/guardrails-approvals
- Azure OpenAI computer use (`pending_safety_checks`): https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/computer-use
- Gemini computer use (`safety_decision`): https://ai.google.dev/gemini-api/docs/computer-use
- Gemini 3.5 Flash computer use: https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-computer-use-gemini-3-5-flash/
- Agent S3 / bBoN: https://arxiv.org/abs/2510.02250, https://github.com/simular-ai/Agent-S
- cua composite agents: https://cua.ai/docs/cua/guide/advanced/composed-models
- Stagehand caching: https://www.browserbase.com/blog/stagehand-caching
