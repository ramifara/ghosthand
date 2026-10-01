# Web testing agent: what to take from existing projects

Date: 2026-09-30. All repos are shallow clones in `/home/outpostone/dev/jev-computer-use/research/refs/<name>`.
Playwright is a sparse clone (`packages/injected/src`, `packages/isomorphic`, `packages/playwright-core/src/{server,tools}`,
`packages/playwright/src/{agents,mcp}`, `docs/src/test-agents-js.md`, `examples/todomvc/{specs,tests}`).
Paths below are relative to each repo root unless absolute.

Context: our web lane uses Playwright, Jev (text-only typed questions: `noul` yes/no, `choice` of up to 255 options,
`score` over 2 to 10 levels), a hosted LLM/VLM for planning, free text and visual judgement, deterministic oracles and a
scored report. See `/home/outpostone/dev/jev-computer-use/plan/AGENT_PLAN.md`.

---

## 1. Playwright core: AI aria snapshot and refs (repo `playwright`)

The MCP server now lives in Playwright itself: `packages/playwright-core/src/tools/` (backend tools, mcp server, cli).
`playwright-mcp` (v0.0.83) is only a thin wrapper (`index.js`, `cli.js`, `config.d.ts`, README with the options table).
The old private `_snapshotForAI` is now public API: `page.ariaSnapshot({ mode: 'ai', depth, boxes })` and
`page.ariaSnapshotJSON(...)` (`packages/playwright-core/src/server/frames.ts:1851-1858`).

### 1.1 State representation
- Builder: `packages/injected/src/ariaSnapshot.ts`. Modes: `'ai' | 'default' | 'codegen' | 'autoexpect'` (line 41).
  AI mode options (lines 60-70): `visibility: 'ariaOrVisible', refs: 'interactable', includeGenericRole: true,
  renderActive, renderCursorPointer: true`. So in AI mode, visually visible but aria-hidden content still appears, and
  `generic` divs are kept, then compressed.
- Refs are given only to interactable nodes: `if (options.refs === 'interactable' && (!ariaNode.box.visible ||
  !ariaNode.receivesPointerEvents)) return;` (`computeAriaRef`, line 222ff).
- **Ref stability**: the ref is cached on the DOM element and reused while role+name are unchanged:
  `if (!ariaRef || ariaRef.role !== ariaNode.role || ariaRef.name !== ariaNode.name) { ariaRef = {..., ref: prefix + 'e' + (++lastRef)} }`.
  So refs are stable across snapshots of the same page, which allows diffing and "is ref eN still here" checks.
  Iframes get a prefix `f<seq>` (`injectedScript.ts:327`), so refs look like `e12` or `f1e3`.
- Iframes are expanded by recursive snapshot through `aria-ref=${ref} >> internal:control=enter-frame >> body,frameset`
  (`server/page.ts:1129-1175`). Snapshot retries with backoff `[1000, 2000, 4000, 8000]`.
- Props captured: `checked`, `disabled`, `expanded`, `invalid`, `level`, `pressed`, `selected`, `active`,
  `/url` for links (data URLs truncated), `/placeholder` for textboxes when it differs from the name
  (ariaSnapshot.ts:198-206).
- Rendering: `packages/isomorphic/ariaSnapshotRenderer.ts:38-80`. YAML list, one line per node:
  `- button "Submit" [disabled] [ref=e7] [cursor=pointer]`, `- textbox "Email" [active] [ref=e4]`, text as `- text: ...`,
  props as child lines `- /url: /login`. Optional `[box=x,y,w,h]` (viewport CSS px) when `boxes: true`.
  Names longer than 900 chars are dropped (YAML key limit).
- Pruning ("distiller", `packages/injected/src/ariaSnapshotDistiller.ts`), AI preset plugins:
  `mergeStringChildren`, `unwrapSingleChildGenerics` ("Only unwrap a generic that encloses at most one element"),
  `removeNamelessImages`, `removeRedundantNames` (drop a name that only repeats content that is shown anyway),
  `removeNameRepeatingChild`, `inlineTextIntoGeneric`. Removed nodes keep their refs resolvable:
  "refs of removed nodes still resolve through the aria-ref selector engine".
- `depth` option caps the render depth. There is no token cap; `browser_find`
  (`packages/playwright-core/src/tools/backend/find.ts`) greps the snapshot and returns matches with 3 lines of context
  under their tree path, "cheaper than capturing the whole snapshot when you only need to locate an element and its ref".
- Tool response layout (`tools/backend/response.ts`): markdown sections `### Ran Playwright code`, `### Page`
  (URL, title), `### Modal state` (dialogs, file choosers: "can be handled by <tool>"), `### Snapshot` (yaml), new console
  entries, events. Snapshot mode is `'full' | 'none'` (`tools/mcp/config.d.ts:246`). There is no longer an
  incremental/diff mode in this version.

### 1.2 Actions and ref to locator
- `Tab.targetLocators` (`tools/backend/tab.ts:560-585`): a target matching `/^(f\d+)?e\d+$/` becomes
  `page.locator('aria-ref=e12')`, then `locator.normalize()` turns it into the best public locator
  (for example `getByRole('button', { name: 'Submit' })`). Any other string is parsed as a Playwright locator/selector.
  Error text: "Ref e12 not found in the current page snapshot. Try capturing new snapshot."
- `aria-ref` engine (`packages/injected/src/injectedScript.ts:762`): looks the ref up in `_lastAriaSnapshotForQuery.info`
  and returns the element only if `isConnected`. So refs are valid only against the latest snapshot.
- `normalize()` uses the selector generator scores (`packages/injected/src/selectorGenerator.ts:40-66`):
  testid 1, other data-test* 2, role+name 100, placeholder 120, label 140, alt 160, text 180, title 200, CSS id 500,
  nth 10000, CSS fallback 1e7. This is how a one-off ref becomes a durable locator for a cache.
- Core tools (`tools/backend/*.ts`): `browser_navigate/_back/_forward/_reload`, `browser_snapshot` (target, depth, boxes),
  `browser_find`, `browser_click` (doubleClick, button, modifiers), `browser_hover`, `browser_drag`, `browser_type`
  (text, submit, slowly), `browser_press_key`, `browser_press_sequentially`, `browser_select_option`, `browser_check/_uncheck`,
  `browser_fill_form` (many fields at once), `browser_file_upload`, `browser_handle_dialog`, `browser_wait_for`
  (text / textGone / time), `browser_tabs`, `browser_take_screenshot`, `browser_console_messages`,
  `browser_network_requests`, `browser_evaluate`, `browser_run_code_unsafe`. Opt-in caps: `vision` (x/y mouse),
  `testing` (verify tools), `network` (route/mock), `storage`, `devtools` (tracing, video), `pdf`.
- Every action tool records a structured action: `response.addAction({ name: 'click', selector, button, clickCount })`
  and emits generated code. This log is what Test Agents turn into a spec file.
- Every action is wrapped in `tab.waitForCompletion(...)` and raced against modal states (dialog / file chooser).

### 1.3 Assertions (`tools/backend/verify.ts`, cap `testing`)
Deterministic, typed, no model judgement:
- `browser_verify_element_visible {role, accessibleName}` → `getByRole(role, {name})` count > 0 in any frame.
- `browser_verify_text_visible {text}` → `getByText(text).filter({visible: true})`.
- `browser_verify_list_visible {target, items[]}` → emits an `assertSnapshot` aria template.
- `browser_verify_value {type: textbox|checkbox|radio|combobox|slider, target, value}` → `inputValue()` / `isChecked()`.
Each success records `assertVisible` / `assertValue` / `assertChecked` / `assertSnapshot` actions for codegen.
Aria snapshot templates (`expect(locator).toMatchAriaSnapshot(yaml)`, engine `internal:aria-template`,
`injectedScript.ts:770`) are a strong structural oracle.

### 1.4 Credentials
- `--secrets <dotenv file>` → `config.secrets`. `context.lookupSecret(name)` (`tools/backend/context.ts:433`): if the text
  the model passes is a secret NAME, the real value is typed; codegen writes `process.env['NAME']`
  (`codegen.ts:58-75`), and the action log stores `SECRET_NAME`.
- `redactSecrets(text)` replaces every secret value with `<secret>NAME</secret>` in logs and written files
  (`context.ts:443`, `logFile.ts:94`, `response.ts:123`).
- Auth state: `--storage-state`, `browser_storage_state` / `browser_set_storage_state`, cookie and localStorage tools.
- No TOTP support.

### 1.5 Guardrails
- `network.allowedOrigins` / `blockedOrigins` (`context.ts:386-399`): allowlist implemented as `context.route('**', abort)`
  plus `route.continue()` per allowed origin glob. README: "does not serve as a security boundary and does not affect
  redirects". `file:` URLs are blocked unless `allowUnrestrictedFileAccess` (`context.ts:424`).
- Tools are tagged `type: 'readOnly' | 'input' | 'assertion' | 'action'`, and element tools carry a free-text `element`
  field "used to obtain permission to interact with the element".

### 1.6 Evidence
`browser_start_tracing/_stop_tracing` (Playwright trace zip), `browser_start_video/_stop_video/_video_chapter`,
`browser_take_screenshot`, `--save-session`, `--output-dir`, console and network logs per response.

---

## 2. Playwright Test Agents (repo `playwright`, `packages/playwright/src/agents` + `packages/playwright/src/mcp/test`)

Docs: `docs/src/test-agents-js.md` (https://playwright.dev/docs/test-agents). Three agent definitions generated into
`.github/agents` / `.claude/agents` by `generateAgents.ts`:

- **Planner** (`playwright-test-planner.agent.md`): explores with browser tools after `planner_setup_page` runs a
  **seed test** (`tests/seed.spec.ts`, which handles login and fixtures). "Do not take screenshots unless absolutely
  necessary". Scenarios must include "Assumptions about starting state (always assume blank/fresh state)",
  "Success criteria and failure conditions", "Include negative testing scenarios", "scenarios are independent".
  Output through `planner_save_plan`, typed schema (`mcp/test/plannerTools.ts:45-56`):
  `{overview, suites:[{name, seedFile, tests:[{name, file, steps:[{perform?, expect: string[]}]}]}]}`, rendered to
  Markdown (plannerTools.ts:90-125).
- **Generator** (`playwright-test-generator.agent.md`): replays each plan step live via MCP tools, passing the step
  text as `intent`; `GeneratorJournal` (`mcp/test/testContext.ts:42-75`) logs `{title: intent, code}` per tool call, then
  `generator_read_log` returns plan + seed + steps + best practices ("Use reliable locators from this log",
  "NEVER! use page.waitForTimeout()"), and `generator_write_test` writes one `.spec.ts` per scenario with
  `// spec: specs/plan.md` and a comment per step.
- **Healer** (`playwright-test-healer.agent.md`): `test_run` → `test_debug` (pauses on error, returns page URL, title,
  console errors, AI aria snapshot and "Try recovering from the error prior to continuing",
  `mcp/test/browserBackend.ts:90-115`) → edits the code → reruns. If the app seems broken rather than the test:
  "mark this test as test.fixme() ... Add a comment before the failing step explaining what is happening".
- Orchestration prompt `playwright-test-coverage.prompt.md`: planner → generator per case sequentially → healer.

**Spec format worth copying** (`examples/todomvc/specs/basic-operations.plan.md`):
```
### 1. Adding Todos
**Seed:** `tests/seed.spec.ts`
#### 1.1. should-add-single-todo
**File:** `tests/adding-todos/should-add-single-todo.spec.ts`
**Steps:**
  1. Type 'Buy groceries' into the input field
    - expect: The text appears in the input field
  2. Press Enter to submit the todo
    - expect: The new todo 'Buy groceries' appears in the todo list
    - expect: The todo counter shows '1 item left'
```
Main idea: the durable artifact is generated Playwright code, and healing is an LLM editing that code. Replay costs no
model calls; the model is used only to plan, generate and heal.

