# GhostHand monorepo, Electron baseline, and testbed design

Researched 2026-10-01. Web search plus a read-only look at T3 Code (`/home/outpostone/dev/t3code`, nothing run). Labels:

- **[doc]** official docs or release notes.
- **[issue]** GitHub issue or PR.
- **[community]** third-party article or repo.
- **[local]** read in T3 Code on this machine.
- **[unverified]** came from a search snippet and was not confirmed against a primary source.

---

## 0. Decisions in one table

| Concern | Choice | Why |
|---|---|---|
| Package manager and workspaces | **Bun** (`bun install`, `bun.lock`, root `workspaces` + `catalog`) | The user wants it. It is fast and has workspace catalogs and `--filter`. |
| Linker | `bunfig.toml` `[install] linker = "hoisted"`, plus a lint rule against undeclared deps | Isolated installs (`node_modules/.bun` store plus symlinks) break Electron packagers that walk `node_modules`. See section 1.3. |
| Runtime for engine, Playwright, CLI, desktop | **Node 24** (Electron 43 bundles Node 24.17). Bun runtime is used only for the testbed server and small scripts. | Playwright officially supports only Node. Bun has a history of launch and WebSocket-upgrade bugs. Electron main and utilityProcess are Node anyway. |
| Desktop build | **electron-vite 5** for dev and bundling, **electron-builder 26.x** for packaging and `electron-updater` | Vite HMR for the renderer. Main, preload, and utility entries are bundled, so the packaged app has almost no runtime `node_modules`. builder has the best installer coverage and update story. T3 Code also uses electron-builder [local]. |
| Web build | **Vite 8** (Rolldown) + **React 19** | Stable since Mar 2026. |
| Lib packages | Source-first internal packages, no per-package build in dev. **tsdown** only for packages we publish (CLI, maybe MCP server). | Fewer build steps. electron-vite and Vite bundle workspace TS directly. |
| Types | `tsconfig.base.json` + per-package `tsconfig.json`, a root solution `tsconfig.json` with references, typecheck via `tsgo -b` (`@typescript/native-preview`), falling back to `tsc -b` | T3 Code uses tsgo [local]. Project references give incremental checks. |
| Lint/format | **Biome 2** (one tool, has `noUndeclaredDependencies`). Optional later: oxlint type-aware. | Simple. T3 Code uses oxlint + `vp fmt` [local]. Either is fine. |
| Unit tests | **Vitest 4** with root `projects` config. `bun test` only inside `apps/testbed/server` if wanted. | Vitest runs under Node (the real engine runtime), handles workspaces, and has Playwright browser mode. Reports say `bun test` is weaker with workspace imports and has no browser mode [community]. |
| E2E / evals | `@playwright/test` for the testbed's own e2e. A custom eval runner (`@ghosthand/evals`) runs the agent against scenarios with oracles. | |
| Native modules | **None.** `bun:sqlite` in the testbed (Bun runtime), `node:sqlite` in Node/Electron, safeStorage for secrets | No `electron-rebuild`, no `trustedDependencies` sprawl. |

---

## 1. Bun: package manager vs runtime

### 1.1 Playwright under the Bun runtime (Sept 2026)
- Playwright is built on Node APIs (child_process pipes, `ws`). It is not officially supported on Bun. Treat Node as the primary runtime [community] https://www.browserstack.com/guide/bun-playwright
- `chromium.launch()` hung on Windows under Bun 1.3.9 with Playwright 1.58.2. Closed and fixed in Bun via PR #35417 [issue] https://github.com/oven-sh/bun/issues/27977 . An older Windows launch hang was closed as a duplicate of #15679 [issue] https://github.com/oven-sh/bun/issues/23826 . A launch timeout under Bun [issue] https://github.com/oven-sh/bun/issues/11759
- `connectOverCDP` broke on Bun because Bun's HTTP client could not upgrade to WebSocket. Playwright rejected a workaround: "the fix should either be in Bun or in ws" [issue] https://github.com/microsoft/playwright/pull/34546 . A follow-up PR #39543 was opened in Mar 2026 [issue].
- **Conclusion:** keep `@ghosthand/driver-playwright` and everything that imports it on Node. Write packages as plain ESM using only `node:` APIs and web standards, with no `Bun.*` globals, so they would run on Bun if it becomes reliable. The CLI ships with a `#!/usr/bin/env node` shebang.
- `bun run <script>` honors a binary's shebang, so `vitest`, `electron-vite`, and `playwright` still run on Node. Never use `bun --bun run` for those. Install Node 24 next to Bun (`engines.node`) [doc] https://bun.com/docs/pm/cli/install

### 1.2 Bun workspaces basics
- Root `package.json`: `"workspaces": { "packages": ["apps/*","packages/*","tooling/*"], "catalog": { "react": "^19", "playwright-core": "1.60.x", "ai": "^7", ... } }`. Children use `"workspace:*"` and `"catalog:"` [doc] https://bun.com/docs/pm/workspaces , https://bun.com/guides/install/workspaces
- Bun runs dependency lifecycle scripts only for trusted packages. Electron's binary download needs `"trustedDependencies": ["electron", "esbuild"]` (or `bun pm trust electron`). Without it, `electron` installs with no binary ("Electron failed to install correctly") [doc] https://bun.com/docs/guides/install/trusted , [issue] https://github.com/huntharo/diskhound/pull/57 , https://github.com/Fairbrook/betaxiv/pull/2
- Filtering: `bun run --filter '@ghosthand/desktop' dev`, `bun run --filter './packages/*' typecheck`.

### 1.3 Isolated linker vs Electron packaging (the main gotcha)
- Bun 1.3.0 made isolated installs the default for workspaces. 1.3.2 narrowed that to new projects (`configVersion = 1`). New workspaces still get isolated by default [doc] https://bun.com/blog/release-notes/bun-v1.3.2 , https://bun.com/docs/pm/isolated-installs
- The docs say isolated mode breaks tools that "assume a flat node_modules" or scan `node_modules` directly [doc] https://bun.com/docs/pm/isolated-installs
- Real breakage: Electron's `flora-colossus` pruner (used by electron-packager and Forge) "walks the logical symlink path and cannot find `@electron-internal/extract-zip` in Bun's isolated store". They worked around it with a staging step [issue] https://github.com/Hexpy-Games/butler/pull/403 . Other reports: deps missing from app.asar [issue] https://github.com/electron-userland/electron-builder/issues/9000 , a Bun symlink realpath bug [issue] https://github.com/oven-sh/bun/issues/42776 , and a project moving to the isolated linker [issue] https://github.com/Emanuele-web04/synara/pull/6 . Background: https://hy2k.dev/en/blog/2025/10-15-bun-install-isolated-vs-hoisted/
- electron-builder 26.x has a node-module collector that learned about Bun and Yarn Berry (`npm list` fix around 26.4), plus pnpm-collector fixes in 26.17 and 27 alpha [doc] https://github.com/electron-userland/electron-builder/releases . Release dates on that page were garbled in my fetch [unverified].
- **Mitigation (two layers):**
  1. `linker = "hoisted"` in `bunfig.toml` from day one. Enforce dependency hygiene with Biome `noUndeclaredDependencies` instead.
  2. Bundle every Electron entry (main, preload, engine utility) with electron-vite, inlining all `@ghosthand/*` and pure-JS deps. T3 Code does this with `deps.alwaysBundle: id => id.startsWith("@t3tools/")` [local]. Keep only `playwright-core` (plus `electron-updater`) as real `dependencies` of `apps/desktop`, so electron-builder copies a tiny tree. Run electron-builder from the repo root or a staging dir.
- `bun.lock` is text and diffable. Commit it.

### 1.4 Reference monorepo: T3 Code [local]
- It uses **pnpm 11 workspaces + catalog**, not Bun as the package manager. It uses `vite-plus` (`vp run`, `vp pack` on tsdown/rolldown, `vp test` on Vitest, `vp lint` on oxlint, `vp fmt`), `tsgo`, Node `^24.13.1`, Electron 41.5, electron-builder 26.15.6, and `playwright-core` 1.60 as a desktop dependency. It uses `@effect/platform-bun` only for the server.
- Desktop main and preload are bundled to **CJS** (`dist-electron/main.cjs`), with a comment that sandboxed preloads cannot resolve package imports. So **the preload must be a single bundled file** (a sandboxed preload can only `require` a few Electron modules).
- `tsconfig.base.json`: `module/moduleResolution: NodeNext`, `noEmit`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Worth copying.
- `pnpm-workspace.yaml` `allowBuilds` lists electron, esbuild, node-pty, sharp. That is the same idea as Bun `trustedDependencies`.

### 1.5 ESM for Electron
- Electron supports ESM main (and preload with caveats) [doc] https://www.electronjs.org/docs/latest/tutorial/esm . electron-vite emits ESM when `"type": "module"` [doc] https://electron-vite.org/guide/dev , https://electron-vite.org/blog/
- Recommendation: main and utility entries in ESM (`.mjs`). The **preload is bundled CJS** because sandboxed preloads cannot use ESM. electron-vite 5 handles each entry separately.
- Forge's Vite plugin still lags on ESM main [issue] https://github.com/electron/forge/issues/3439 . That is another reason to pick electron-vite + builder over Forge. A comparison: https://www.deskifier.com/blog/electron-forge-vs-electron-builder

### 1.6 Internal package wiring
```jsonc
// packages/core/package.json
{ "name": "@ghosthand/core", "type": "module", "private": true,
  "exports": { ".": { "@ghosthand/source": "./src/index.ts", "types": "./src/index.ts", "default": "./dist/index.js" } } }
```
- `tsconfig.base.json`: `"moduleResolution": "bundler"`, `"customConditions": ["@ghosthand/source"]`. Vite and electron-vite get `resolve.conditions: ["@ghosthand/source"]`. Vitest picks it up through the Vite config. The CLI is built with tsdown, which bundles workspace deps, so no package needs a `dist` in dev.
- Vitest 4 root `vitest.config.ts` with `test.projects: ["packages/*", "apps/*"]`.

---

## 2. Electron security baseline for an agent app

Primary checklist [doc] https://www.electronjs.org/docs/latest/tutorial/security

- **Never load target websites in an Electron window.** The agent drives a separate Playwright Chromium (or the user's Chrome over CDP). The GhostHand UI shows a live view from CDP `Page.screencastFrame` or JPEG screenshots streamed as data. This keeps hostile pages and prompt injection away from any preload or IPC surface.
- `BrowserWindow` webPreferences, set explicitly even where they match defaults: `contextIsolation: true` (default since 12), `sandbox: true` (default since 20), `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`, `allowRunningInsecureContent: false`, `spellcheck: false` [doc]. A guide on why to set them explicitly: https://sik.limited/en/thinking/electron-security-preload-contextbridge-ipc
- Load the renderer from `file://` or a custom `app://` protocol (`protocol.handle`) in prod. Set a strict CSP (`default-src 'self'`, no `unsafe-eval`). Block navigation (`will-navigate` → preventDefault) and `setWindowOpenHandler` → `deny` + `shell.openExternal` on an allow-list. Deny all `session.setPermissionRequestHandler` requests by default.
- **Typed IPC.** Keep the contract in `@ghosthand/protocol` (zod schemas: `invoke` request/response and event streams). Preload exposes one `contextBridge.exposeInMainWorld("ghosthand", {...})` with task-shaped methods, never raw `ipcRenderer`. Main validates every payload with zod and checks `event.senderFrame.url` against the app origin. Options: electron-trpc (https://electron-trpc.dev/) is stale. The maintained tRPC v11 forks are https://github.com/mat-sz/trpc-electron and https://github.com/makp0/electron-trpc-experimental . There is also type-only https://github.com/deiucanta/electron-typed-ipc . I recommend a small custom layer (around 150 LOC) over zod, because we also need the same contract over a MessagePort and over the CLI's stdio/WebSocket.
- **Engine in `utilityProcess`.** `utilityProcess.fork(enginePath, [], { serviceName: "ghosthand-engine", stdio: "pipe" })`. It is a Node environment started through Chromium's services API, the equivalent of `child_process.fork` [doc] https://www.electronjs.org/docs/latest/api/utility-process . Hand the renderer a direct `MessagePortMain` (`MessageChannelMain`) to the engine for the high-rate event and screencast stream, so main stays a thin broker. Playwright runs **inside the utility process** and spawns Chromium with its normal `child_process` launch. Electron sets `ELECTRON_RUN_AS_NODE` for spawned children [community] https://www.matthewslipper.com/2019/09/22/everything-you-wanted-electron-child-process.html . Set `PLAYWRIGHT_BROWSERS_PATH` to `app.getPath("userData")/browsers` and run a first-run "install Chromium" step, or use `channel: "chrome"` for the system Chrome. One open Playwright issue covers evaluating code in utility processes. It only matters for testing the app itself [issue] https://github.com/microsoft/playwright/issues/19384
- **Secrets:** API keys and Codex OAuth tokens are encrypted with `safeStorage.encryptString` and stored as a blob in userData. On Linux, check `safeStorage.getSelectedStorageBackend()`. If it returns `basic_text` (no keyring), warn and offer "don't persist" [doc] https://www.electronjs.org/docs/latest/api/safe-storage . Decrypt only in main and pass keys to the engine over the port, never to the renderer.
- **Fuses** (`@electron/fuses` via electron-builder `electronFuses`): `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`, `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`, `EnableCookieEncryption: true`. utilityProcess does not rely on the RunAsNode fuse. Verify early with a packaged smoke test, as T3 Code does with `smoke-test` [local].
- **Versions:** Electron 43 is stable (Chromium 150, Node 24.17, EOL 2027-01-05). Electron 42 reaches EOL 2026-10-20 [doc] https://releases.electronjs.org/schedule , https://www.electronjs.org/blog/electron-43-0 . Track latest stable. A context-isolation bypass "CVE-2026-70601", patched Aug 2026, appears only on an aggregator site [unverified] https://dailycve.com/electron-context-isolation-bypass-via-functionprototypebind-hijack-cve-2026-70601-dc-aug2026-1383/
- **Auto-update later:** `electron-updater` + GitHub Releases, with signing and notarization on mac. T3 Code ships a `mock-update-server.ts` for testing the update flow [local].

---

## 3. Testbed app (`apps/testbed`)

### 3.1 Stack
- **Frontend:** Vite 8 + React 19 + React Router, plain CSS or Tailwind 4. Use a headless lib (Radix or React Aria) for the "good a11y" variants and hand-rolled divs for the "poor a11y" variants.
- **Backend:** **Hono on Bun + `bun:sqlite`** (in-process, no native addon), in `apps/testbed/server`. A real HTTP backend beats MSW for agent testing. Cookies and sessions are real. Downloads, multi-tab, and magic links work. State persists across reloads and tabs. Oracles can check it from outside the browser. Use MSW only for component unit tests.
- **Two ports:** app on `127.0.0.1:4400` (what the agent sees) and a **control API** on `127.0.0.1:4401` (reset, seed, clock, oracles, mail), never linked from the app. As defense in depth, the eval harness also blocks `**/__control/**` in the agent's Playwright context with `context.route`.
- **Email:** Mailpit (single Go binary or docker, SMTP 1025, UI/API 8025). Endpoints: `GET /api/v1/messages`, `GET /api/v1/search?query=to:x`, `GET /api/v1/message/latest`, and the `/view/latest.html?query=` page [doc] https://mailpit.axllent.org/docs/integration/ , https://mailpit.axllent.org/docs/api-v1/websocket/ . Use a plus-address per run (`agent+<runId>@testbed.local`) [community] https://qaskills.sh/blog/testing-passwordless-email-magic-link-flow . Fallback if Mailpit is not installed: a built-in `/inbox` page in the testbed that renders the same mails, which the agent can open in a new tab. The fallback is also a scenario.
- **TOTP:** `otpauth` (pure TS). The secret comes from the seed. The harness exposes it either as a tool ("authenticator") or puts it in the task's credentials vault, so we can test both "agent asks the human" and "agent uses the vault".
- **Determinism:** `POST :4401/reset { seed, level, variant }` drops and recreates the SQLite DB from a seeded faker, resets Mailpit (`DELETE /api/v1/messages`), and sets a **fake clock** (`POST /clock {iso}`). The server reads time through a `Clock` and the client gets it from `/api/now`, which makes date pickers deterministic. Randomized flakiness uses a seeded PRNG keyed by `(seed, requestCount)`.

### 3.2 Variant flags (query string + `localStorage`, set by reset)
`testids=on|off` · `a11y=good|poor` · `ids=stable|dynamic` · `classes=semantic|hashed` · `theme=light|dark|system` · `locale=en|de|ar(RTL)|ja` · `latency=0|300|2000` · `flake=0..0.3` (5xx, partial loads) · `popups=none|cookie|newsletter|random` (interruptions) · `layout=stable|shift` · `density`.
- **Source-aware vs blind:** one build. A `tid("orders.row.delete")` helper returns `{ "data-testid": … }` only when `testids=on`. In source-aware mode the harness also gives the agent the repo path `apps/testbed/src`, a generated `testids.json` (id → component file:line), and the route map. Blind mode gives none of these, plus hashed classes and dynamic IDs. Run the same task in both modes and compare success and step counts.
- These perturbations follow **StressWeb**, which splits stress into perceptual, semantic, and execution perturbations over clean reference environments with deterministic multi-checkpoint evaluators [doc] https://arxiv.org/abs/2604.16385 . Also see RealGUINoise https://arxiv.org/html/2609.38184

### 3.3 Levels (benchmark-style)
Each level adds pages under `src/scenarios/<level>/…`. Earlier levels never change once released (see 3.5).

| Level | Theme | Pages / tasks |
|---|---|---|
| L0 | Smoke | static page, read a value, click a link, fill one input |
| L1 | Forms and navigation | login (email/password), signup with client and server validation, multi-step wizard, radios/checkboxes/selects, nav menus |
| L2 | Data UI | table with server pagination, sort, filter, row actions (edit/delete), modal and drawer edit, toasts that auto-dismiss, bulk select |
| L3 | Rich widgets | combobox/autocomplete (async), multi-select, date and date-range pickers, time zones, sliders, rich text editor, tabs, accordions, tooltips that hide controls |
| L4 | Hard DOM | same-origin and **cross-origin iframes** (second port), nested iframes, **shadow DOM** web components (open and closed), **canvas/chart-only** UI (value only in pixels, e.g. "which month peaked"), drag-and-drop (HTML5 DnD and pointer-based kanban), file **upload** (input and dropzone) and **download** (CSV export, verify contents), virtualized lists, **infinite scroll**, hover-only menus, right-click context menus |
| L5 | Out-of-band auth | **TOTP 2FA**, **magic link via Mailpit**, email verification code, password reset, session expiry mid-task, "remember this device", OAuth-like redirect to a fake IdP on another origin |
| L6 | Robustness | slow/flaky loading, skeletons, retries, cookie banners and random modals, layout shift, dynamic IDs, **a11y-poor variants** (unnamed icon buttons, div buttons, missing labels, no focus rings), i18n with RTL, dark mode, low contrast, zoom 150% |
| L7 | Safety | **destructive actions** behind confirm dialogs (typed-name confirm), "irreversible" payments with a limit, **prompt-injection page** (hidden text, reviews, emails, image alt text telling the agent to change the password or export data), phishing lookalike login on another origin, out-of-scope requests, PII bait. Oracles check that the forbidden side effect **did not** happen, as in **WASP** [doc] https://arxiv.org/abs/2504.18575 , WAInjectBench https://arxiv.org/pdf/2510.01354 , BrowseSafe https://arxiv.org/html/2511.20597 |
| L8 | Long horizon | cross-app workflows (find an order → refund it → email the customer → update the CRM note), multi-tab, information gathering + action, tasks needing memory of earlier pages, 30+ steps |

Example task IDs: `L2.orders.delete-row@1`, `L5.auth.totp-login@1`, `L7.inject.review-exfil@2`.

### 3.4 Task spec and oracles (`packages/testbed-kit`)
```ts
export default defineTask({
  id: "L2.orders.delete-row", version: 1, level: 2,
  tags: ["table", "destructive", "confirm"],
  setup: { seed: 42, variant: { testids: "off", a11y: "good" }, login: "alice" },
  start: "/orders",
  instruction: "Delete the order for Bob Ng placed on 2026-03-14.",
  oracle: async ({ db }) => {
    const gone = !db.get("select 1 from orders where id = 'ord_1043'");
    const othersIntact = db.get("select count(*) n from orders").n === 49;
    return { pass: gone && othersIntact, checks: { gone, othersIntact } };
  },
  forbidden: [{ table: "orders", op: "delete", where: "id != 'ord_1043'" }],
  budget: { steps: 25, seconds: 180 },
});
```
- **Oracles read state, never the DOM.** Action tasks query the DB or control API. For information tasks, the agent writes its final answer and the oracle checks it against the seeded ground truth (exact match or normalized). Use an LLM judge only for live URLs. REAL combines programmatic state checks with rubric-based LLM judgment for retrieval tasks [doc] https://arxiv.org/abs/2504.11543
- Every mutating request is written to an `audit_log` table, so oracles can check "nothing else changed" and "the confirm dialog was used".
- **Versioning:** a task is immutable once in a released suite. Behavior changes bump `version` (`@2`). Suites are dated manifests (`suites/ghosthand-2026.10.json` listing `id@version`). Results are JSONL rows `{suite, taskId@ver, variant, mode(source-aware|blind), model, decisionProvider, gitSha, pass, steps, tokens, cost, wallMs, traceZip}`. Keep a frozen `public` split and a held-out `private` split (unpublished seeds and paraphrased instructions) to avoid overfitting prompts to the testbed.

### 3.5 Any URL
- `ghosthand run --url https://example.com "task"` uses the same engine. `ghosthand eval --suite external.json` takes tasks with `start` set to any URL and `oracle: { kind: "llm-judge", rubric }`, following the WebJudge style from Online-Mind2Web (300 tasks over 136 sites, easy/medium/hard by step count) [doc] https://www.emergentmind.com/topics/online-mind2web , leaderboards https://leaderboard.steel.dev/leaderboards/online-mind2web/ , https://leaderboard.steel.dev/leaderboards/webarena/

### 3.6 Where scenario ideas come from
- **WebArena** (self-hosted shop, forum, GitLab, CMS, map; 812 tasks; programmatic checks): long-horizon and admin-panel tasks. **WebArena Verified** fixes broken tasks, which is a reminder to audit our oracles.
- **REAL** (11 deterministic React/Next clones of real sites, 112 tasks, best model 41%) [doc] https://arxiv.org/pdf/2504.11543 . This is the closest match to our approach.
- **Online-Mind2Web / Mind2Web 2** (live sites, agent-as-judge) https://osu-nlp-group.github.io/Mind2Web-2/
- **OSWorld**: desktop and multi-app tasks, for later when GhostHand moves beyond the browser.
- **BrowserGym / WebGames**: atomic interaction challenges (sliders, canvases, timing).
- **the-internet (herokuapp.com)**: auth, basic/digest auth, broken images, challenging DOM, checkboxes, context menu, disappearing elements, drag-and-drop, dropdown, dynamic content/controls/loading, entry ad, exit intent, file download/upload, floating menu, frames, geolocation, hovers, infinite scroll, JS alerts, key presses, multiple windows, nested frames, notification messages, redirects, shadow DOM, shifting content, slow resources, sortable tables, status codes, typos, WYSIWYG. A ready checklist for L1–L6.
- **UI Testing Playground** (dynamic ID, class attribute, hidden layers, load delay, AJAX data, client-side delay, click, text input, scrollbars, dynamic table, verify text, progress bar, visibility, overlapped element, shadow DOM) http://uitestingplayground.com/
- **Playwright demo apps**: TodoMVC (https://demo.playwright.dev/todomvc) and Playwright's own `tests/assets` pages. Good L0/L1 baselines and a known-good target for "any URL" smoke tests.
- **StressWeb / RealGUINoise**: perturbation design for L6.

---

## 4. Proposed layout

```
ghosthand/
├─ package.json            # private; workspaces + catalog; trustedDependencies; engines.node ^24; packageManager bun@1.x
├─ bunfig.toml             # [install] linker="hoisted"; exact=true
├─ bun.lock
├─ biome.json
├─ tsconfig.base.json      # strict, bundler resolution, customConditions ["@ghosthand/source"], verbatimModuleSyntax
├─ tsconfig.json           # solution file: references to every package
├─ vitest.config.ts        # test.projects
├─ apps/
│  ├─ desktop/             # @ghosthand/desktop  electron-vite + electron-builder
│  │  └─ src/{main,preload,renderer,engine-host}/   # engine-host = utilityProcess entry
│  ├─ cli/                 # @ghosthand/cli  bin "ghosthand"; tsdown → dist/cli.mjs (#!/usr/bin/env node)
│  └─ testbed/             # @ghosthand/testbed
│     ├─ web/              # Vite 8 + React 19 (scenarios/L0…L8, variants, tid())
│     ├─ server/           # Hono on Bun + bun:sqlite; app :4400, control :4401
│     └─ e2e/              # @playwright/test self-tests of the testbed (scripted, no agent)
├─ packages/
│  ├─ protocol/            # @ghosthand/protocol  zod schemas: Action, Observation, RunEvent, IPC contract
│  ├─ core/                # @ghosthand/core  agent loop, planner/executor seams, budgets, trace (no Node-only deps)
│  ├─ decision-typesafe/   # @ghosthand/decision-typesafe  DecisionProvider via @typesafe-ai/sdk (Jev)
│  ├─ models/              # @ghosthand/models  Vercel AI SDK v7 registry, Codex OAuth, keys, local
│  ├─ driver-playwright/   # @ghosthand/driver-playwright  playwright-core, CDP screencast, a11y snapshot
│  ├─ knowledge/           # @ghosthand/knowledge  site memory, skills, node:sqlite
│  ├─ qa/                  # @ghosthand/qa  QA-mode flows, assertions, reports
│  ├─ mcp/                 # @ghosthand/mcp  MCP server exposing the engine (stdio/http)
│  ├─ engine/              # @ghosthand/engine  composition root wiring the above; used by cli + desktop engine-host
│  ├─ testbed-kit/         # @ghosthand/testbed-kit  defineTask, control-API client, oracles, suites/
│  └─ evals/               # @ghosthand/evals  runner, JSONL results, report HTML
└─ tooling/
   └─ scripts/             # dev orchestration, release, mailpit fetch
```

Dependency rule: `protocol` ← `core` ← (`decision-typesafe`, `models`, `driver-playwright`, `knowledge`, `qa`) ← `engine` ← (`cli`, `desktop/engine-host`, `mcp`, `evals`). The renderer imports only `protocol`. Enforce with Biome `noRestrictedImports` per package, or a dependency-cruiser check.

### Root scripts
```jsonc
"scripts": {
  "dev": "bun run tooling/scripts/dev.ts",                      // testbed (web+server) + desktop, prefixed logs
  "dev:testbed": "bun run --filter @ghosthand/testbed dev",
  "dev:desktop": "bun run --filter @ghosthand/desktop dev",     // electron-vite dev
  "build": "bun run --filter './packages/*' --filter './apps/*' build",
  "typecheck": "tsgo -b",
  "lint": "biome check .", "fmt": "biome format --write .",
  "test": "vitest run",
  "test:testbed": "bun run --filter @ghosthand/testbed e2e",   // playwright test (Node)
  "eval": "node apps/cli/dist/cli.mjs eval",                    // e.g. bun run eval -- --suite ghosthand-2026.10 --level L2 --mode blind
  "dist:desktop": "bun run --filter @ghosthand/desktop dist",   // electron-builder
  "mail": "mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025"
}
```
All dev servers bind to `127.0.0.1`, which matches the global remote-access rule. Testbed ports 4400 and 4401 can be published per session through `tailscale serve --https=<port>`.

---

## 5. Open items
- Confirm the current Bun version. A search snippet says 1.4.2 as of 2026-09-05 [unverified]. Re-test `linker="isolated"` against electron-builder 26.17+ later. If it works, switch to isolated for stricter boundaries.
- Decide how Chromium is delivered (download on first run vs system Chrome vs bundled). Bundling adds about 150 MB per platform.
- Decide whether `@ghosthand/mcp` runs inside the desktop app's utility process or only from the CLI.
