// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The web `Computer`: observe (AI aria snapshot + DOM facts), settle, semantic and pointer actions on
// `aria-ref` locators with freshness and hit-test checks, effects from read-back, and the origin guard.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@ghosthand/core";
import { evaluateDeterministic, noopLogger, SecretsRegistry, secretPlaceholder } from "@ghosthand/core";
import type {
  ActionErrorKind,
  ActionResult,
  ActionRoute,
  Capture,
  Computer,
  ComputerCapabilities,
  ComputerError,
  DoctorCheck,
  Evidence,
  FieldValue,
  ObserveScope,
  PointerTarget,
  Predicate,
  PredicateResult,
  Rect,
  Result,
  Snapshot,
} from "@ghosthand/protocol";
import { err, ok, Region } from "@ghosthand/protocol";
import type {
  BrowserContext,
  ConsoleMessage,
  Dialog,
  Frame,
  Locator,
  Page,
  Response,
  Route,
  WebSocketRoute,
} from "playwright-core";
import { z } from "zod";
import type { PageObservation, TargetObservation } from "./action-effects.ts";
import { assess, pageEvidence, targetEvidence, weakEvidence } from "./action-effects.ts";
import type { CaptureTimings } from "./capture-snapshot.ts";
import { captureSnapshot } from "./capture-snapshot.ts";
import { registerGhosthandEngine, runEngine } from "./engine-client.ts";
import { HitTestResult, PageState, TargetProbe as TargetProbeSchema } from "./in-page/page-types.ts";
import {
  describePoint,
  focusState,
  hitTestTarget,
  hoveredAt,
  probeTarget,
  scrollState,
  viewportMetrics,
} from "./in-page/target-scripts.ts";
import { NetworkTracker } from "./network-tracker.ts";
import { OriginGuard } from "./origin-guard.ts";
import { capElements, estimateSnapshotTokens, measureQuality } from "./rank-elements.ts";
import { redactZip } from "./redact-zip.ts";
import { SecretScope } from "./secret-scope.ts";
import type { DomState, SettleOptions, SettleResult } from "./settle.ts";
import { DEFAULT_SETTLE, waitForSettle } from "./settle.ts";
import { generateTotp } from "./totp.ts";

export interface WebComputerOptions {
  context: BrowserContext;
  /** Page to drive; defaults to the context's first page (or a new one). */
  page?: Page;
  /** Secret names → values; models only ever see `[input:NAME]`. */
  secrets?: SecretsRegistry;
  /** Origins the agent may navigate to (task `allowOrigins`). */
  allowOrigins?: readonly string[];
  /** The task's start URL; its origin joins the allowlist. */
  startUrl?: string;
  /** Production origins the agent must never reach (the testbed control API is always blocked). */
  blockOrigins?: readonly string[];
  /** Also block subresources from origins outside the allowlist. */
  strictSubresources?: boolean;
  settle?: Partial<SettleOptions>;
  /** Element cap per snapshot (default 200). */
  maxElements?: number;
  /** Size guard in estimated tokens (default 20 000). */
  maxTokens?: number;
  /** Playwright timeout for one action (default 5 s). */
  actionTimeoutMs?: number;
  /** Settle cap used before reading back an action's effect (default 2 s). */
  effectSettleCapMs?: number;
  /** Close the browser context in `close()` (default false for a context you pass in). */
  closeContext?: boolean;
  logger?: Logger;
}

/** Timings and size facts of the last `observe()`, for reports. */
export interface ObserveStats extends CaptureTimings {
  totalMs: number;
  elementCount: number;
  omitted: number;
  tokenEstimate: number;
  oversized: boolean;
  degraded: boolean;
}

interface LatestSnapshot {
  id: string;
  refs: Map<string, string>;
  ancestors: Map<string, string[]>;
  secretTokens: Set<string>;
  invalidated: boolean;
}

interface CaptureGeometry {
  scale: number;
  region: Rect | undefined;
  scrollX: number;
  scrollY: number;
}

/** A failed HTTP response seen by the page (status ≥ 400), for QA bug reports. */
export interface HttpErrorRecord {
  status: number;
  method: string;
  url: string;
}

/** Most console errors / HTTP errors kept per computer. */
export const MAX_PAGE_ERRORS = 100;

interface BlockedAttempt {
  url: string;
  reason: string;
  topLevel: boolean;
}

interface ResolvedTarget {
  ref: string;
  token: string;
  locator: Locator;
  secretField: boolean;
}

interface ActionContext {
  locator: Locator | undefined;
  before: TargetObservation;
}

interface ActionSpec {
  route: ActionRoute;
  token?: string;
  /** Hit-test the token target before running (pointer-like routes). */
  pointer?: boolean;
  mutating: boolean;
  run(ctx: ActionContext): Promise<void>;
  /** Builds effect and evidence from the read-backs. */
  judge(j: Judgement): { effect: ActionResult["effect"]; evidence: Evidence[] };
}

interface Judgement {
  pageBefore: PageObservation;
  pageAfter: PageObservation;
  before: TargetObservation;
  after: TargetObservation;
  secretField: boolean;
}

const TOKEN = /^((?:f\d+)?e\d+)(s\d+)$/;
const MAX_CAPTURES = 50;

const FocusState = z.object({ desc: z.string(), value: z.string().nullable(), secret: z.boolean() });
const Metrics = z.object({
  innerWidth: z.number(),
  innerHeight: z.number(),
  outerWidth: z.number(),
  outerHeight: z.number(),
  screenX: z.number(),
  screenY: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
  dpr: z.number(),
});

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return (message.split("\n")[0] ?? "").slice(0, 300);
}

function pngSize(data: Uint8Array): { width: number; height: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Creates a WebComputer over an existing context. Registers the selector engine and the origin guard. */
export async function createWebComputer(
  opts: WebComputerOptions,
): Promise<Result<WebComputer, ComputerError>> {
  const registered = await registerGhosthandEngine();
  if (!registered.ok) return registered;
  let page: Page;
  try {
    page = opts.page ?? opts.context.pages()[0] ?? (await opts.context.newPage());
  } catch (e) {
    return err({ kind: "driver", message: `cannot open a page: ${firstLine(e)}` });
  }
  const computer = new WebComputer(opts, page);
  const installed = await computer.install();
  if (!installed.ok) return installed;
  return ok(computer);
}

export class WebComputer implements Computer {
  readonly #context: BrowserContext;
  #page: Page;
  readonly #scope: SecretScope;
  readonly #guard: OriginGuard;
  readonly #tracker = new NetworkTracker();
  readonly #settle: SettleOptions;
  readonly #maxElements: number | undefined;
  readonly #maxTokens: number | undefined;
  readonly #timeout: number;
  readonly #effectCap: number;
  readonly #closeContext: boolean;
  readonly #log: Logger;
  #seq = 0;
  #captureSeq = 0;
  #latest: LatestSnapshot | undefined;
  readonly #captures = new Map<string, CaptureGeometry>();
  #recordingDir: string | undefined;
  #jsDialogs = 0;
  #popups: Page[] = [];
  #navigations = 0;
  #lastAllowedUrl: string | undefined;
  readonly #blocked: BlockedAttempt[] = [];
  readonly #consoleErrors: string[] = [];
  readonly #httpErrors: HttpErrorRecord[] = [];
  #lastStats: ObserveStats | undefined;
  #closed = false;

  constructor(opts: WebComputerOptions, page: Page) {
    this.#context = opts.context;
    this.#page = page;
    this.#scope = new SecretScope(opts.secrets ?? new SecretsRegistry());
    this.#guard = new OriginGuard({
      allow: opts.allowOrigins ?? [],
      block: opts.blockOrigins ?? [],
      strictSubresources: opts.strictSubresources ?? false,
    });
    if (opts.startUrl) this.#guard.allow(opts.startUrl);
    this.#settle = { ...DEFAULT_SETTLE, ...opts.settle };
    this.#maxElements = opts.maxElements;
    this.#maxTokens = opts.maxTokens;
    this.#timeout = opts.actionTimeoutMs ?? 5000;
    this.#effectCap = opts.effectSettleCapMs ?? 2000;
    this.#closeContext = opts.closeContext ?? false;
    this.#log = (opts.logger ?? noopLogger).child({ component: "web-computer" });
  }

  /** The page currently driven (it changes when an action opens a popup). */
  get page(): Page {
    return this.#page;
  }

  /** Console errors and uncaught page exceptions since launch (redacted, capped at MAX_PAGE_ERRORS). */
  get consoleErrors(): readonly string[] {
    return this.#consoleErrors;
  }

  /** Responses with status ≥ 400 since launch (URLs without query strings, capped at MAX_PAGE_ERRORS). */
  get httpErrors(): readonly HttpErrorRecord[] {
    return this.#httpErrors;
  }

  /** Timings and sizes of the last observation. */
  get lastObserveStats(): ObserveStats | undefined {
    return this.#lastStats;
  }

  /** Adds an origin to the allowlist at run time (e.g. after the user approves it). */
  allowOrigin(origin: string): boolean {
    return this.#guard.allow(origin);
  }

  /** @internal Installs routing and listeners; called by createWebComputer. */
  async install(): Promise<Result<void, ComputerError>> {
    try {
      await this.#context.route("**/*", this.#onRoute);
      await this.#context.routeWebSocket((url: URL) => this.#guard.isBlocked(url.href), this.#onWebSocket);
    } catch (e) {
      return err({ kind: "driver", message: `cannot install the origin guard: ${firstLine(e)}` });
    }
    this.#context.on("page", this.#onPopup);
    this.#attach(this.#page);
    return ok(undefined);
  }

  // ---- listeners -------------------------------------------------------------------------------

  readonly #onRoute = async (route: Route): Promise<void> => {
    const req = route.request();
    let topLevel = false;
    try {
      topLevel = req.isNavigationRequest() && req.frame().parentFrame() === null;
    } catch {
      topLevel = false;
    }
    const decision = this.#guard.checkRequest(req.url(), topLevel);
    if (!decision.allowed) {
      this.#blocked.push({ url: req.url(), reason: decision.reason, topLevel });
      if (this.#blocked.length > 100) this.#blocked.splice(0, this.#blocked.length - 100);
      this.#log.warn({ origin: safeOrigin(req.url()), reason: decision.reason, topLevel }, "request blocked");
      await route.abort("blockedbyclient").catch(() => {});
      return;
    }
    await route.fallback().catch(() => {});
  };

  readonly #onWebSocket = (ws: WebSocketRoute): void => {
    this.#blocked.push({ url: ws.url(), reason: "blocklist", topLevel: false });
    void ws.close().catch(() => {});
  };

  readonly #onDialog = (dialog: Dialog): void => {
    this.#jsDialogs++;
    void dialog.dismiss().catch(() => {});
  };

  readonly #onFrameNavigated = (frame: Frame): void => {
    if (frame.parentFrame() !== null) return;
    this.#navigations++;
    const url = frame.url();
    if (this.#guard.check(url).allowed && /^https?:/.test(url)) this.#lastAllowedUrl = url;
  };

  readonly #onPopup = (page: Page): void => {
    if (page !== this.#page) this.#popups.push(page);
  };

  readonly #onConsole = (msg: ConsoleMessage): void => {
    if (msg.type() !== "error") return;
    this.#pushError(msg.text());
  };

  readonly #onPageError = (error: Error): void => {
    this.#pushError(`uncaught ${error.name}: ${error.message}`);
  };

  readonly #onResponse = (res: Response): void => {
    const status = res.status();
    if (status < 400 || this.#httpErrors.length >= MAX_PAGE_ERRORS) return;
    this.#httpErrors.push({ status, method: res.request().method(), url: stripQuery(res.url()) });
  };

  #pushError(text: string): void {
    if (this.#consoleErrors.length >= MAX_PAGE_ERRORS) return;
    this.#consoleErrors.push(this.#scope.redact(text).slice(0, 500));
  }

  #attach(page: Page): void {
    this.#tracker.attach(page);
    page.on("dialog", this.#onDialog);
    page.on("framenavigated", this.#onFrameNavigated);
    page.on("console", this.#onConsole);
    page.on("pageerror", this.#onPageError);
    page.on("response", this.#onResponse);
  }

  #detach(page: Page): void {
    this.#tracker.detach();
    page.off("dialog", this.#onDialog);
    page.off("framenavigated", this.#onFrameNavigated);
    page.off("console", this.#onConsole);
    page.off("pageerror", this.#onPageError);
    page.off("response", this.#onResponse);
  }

  #switchTo(page: Page): void {
    this.#detach(this.#page);
    this.#page = page;
    this.#attach(page);
  }

  // ---- Computer: basics ------------------------------------------------------------------------

  capabilities(): ComputerCapabilities {
    return { surface: "web", semanticActions: true, pointer: true, screenshots: true, recording: true };
  }

  async doctor(): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];
    const browser = this.#context.browser();
    checks.push({
      name: "browser",
      ok: !this.#page.isClosed() && (browser === null || browser.isConnected()),
      detail: browser ? `${browser.browserType().name()} ${browser.version()}` : "persistent context",
    });
    const state = await runEngine(this.#page.mainFrame(), { op: "state" }, PageState, 2000);
    checks.push({
      name: "selector-engine",
      ok: state.ok,
      detail: state.ok ? "installed" : state.error.message,
    });
    checks.push({
      name: "origin-guard",
      ok: this.#guard.hasAllowlist,
      detail: this.#guard.hasAllowlist ? "allowlist set" : "no allowlist yet (set by the first open())",
    });
    return checks;
  }

  async open(target: string): Promise<Result<void, ComputerError>> {
    if (!this.#guard.hasAllowlist) this.#guard.allow(target);
    const decision = this.#guard.check(target);
    if (!decision.allowed)
      return err({
        kind: "navigation",
        message: `origin_blocked: ${safeOrigin(target)} (${decision.reason})`,
      });
    try {
      await this.#page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(this.#timeout, 15_000),
      });
    } catch (e) {
      return err({
        kind: this.#page.isClosed() ? "closed" : "navigation",
        message: this.#scope.redact(firstLine(e)),
      });
    }
    this.#invalidate();
    await this.waitIdle();
    return ok(undefined);
  }

  async waitIdle(opts?: { capMs?: number }): Promise<SettleResult> {
    const settle = { ...this.#settle, ...(opts?.capMs !== undefined ? { capMs: opts.capMs } : {}) };
    return waitForSettle(
      { network: () => this.#tracker.state(), dom: () => this.#domState(), now: Date.now, sleep },
      settle,
    );
  }

  async #domState(): Promise<DomState | undefined> {
    const r = await runEngine(this.#page.mainFrame(), { op: "state" }, PageState, 1000);
    if (r.ok) return r.value;
    if (r.error.kind !== "engine_missing") return undefined;
    try {
      const readyState = await this.#page.evaluate(() => document.readyState);
      return { sinceMutation: Number.POSITIVE_INFINITY, busy: null, readyState };
    } catch {
      return undefined;
    }
  }

  async #pageState(): Promise<PageState | undefined> {
    const r = await runEngine(this.#page.mainFrame(), { op: "state" }, PageState, 1000);
    return r.ok ? r.value : undefined;
  }

  // ---- observe ---------------------------------------------------------------------------------

  async observe(scope?: ObserveScope): Promise<Result<Snapshot, ComputerError>> {
    if (this.#closed) return err({ kind: "closed", message: "the computer is closed" });
    const t0 = Date.now();
    const id = `s${++this.#seq}`;
    const cap = await captureSnapshot({
      page: this.#page,
      scope: this.#scope,
      snapshotId: id,
      timeoutMs: this.#timeout,
      ...(scope?.region !== undefined ? { sectionText: scope.region } : {}),
    });
    if (!cap.ok) return cap;
    const c = cap.value;
    let elements = c.elements;
    let text = c.text;
    let scopedTo: string | undefined;
    if (scope?.region !== undefined && c.regions.some((r) => r.id === scope.region)) {
      // A region from `Snapshot.regions`: its elements and its own text (P1-06 narrowing).
      scopedTo = scope.region;
      elements = elements.filter((e) => c.sections.get(e.token) === scopedTo);
      if (c.sectionText !== undefined) text = c.sectionText;
    } else if (scope?.region !== undefined) {
      const region = Region.safeParse(scope.region);
      if (region.success) elements = elements.filter((e) => e.region === region.data);
      else {
        const ref = TOKEN.exec(scope.region)?.[1] ?? scope.region;
        elements = elements.filter((e) => {
          const own = c.refs.get(e.token);
          return own !== undefined && (c.ancestors.get(own) ?? []).includes(ref);
        });
      }
    }
    const capped = capElements(elements, text, scope?.maxElements ?? this.#maxElements, this.#maxTokens);
    const snapshot: Snapshot = {
      id,
      surface: "web",
      takenAt: Date.now(),
      url: c.url,
      title: c.title,
      viewport: c.viewport,
      elements: capped.elements,
      text,
      tokenEstimate: capped.tokenEstimate,
      quality: measureQuality(capped.elements),
      narrowed: capped.narrowed || scopedTo !== undefined,
      regions: c.regions,
      pageTokenEstimate: estimateSnapshotTokens(c.elements, c.text),
      ...(scopedTo !== undefined ? { scope: scopedTo } : {}),
    };
    const refs = new Map<string, string>();
    for (const el of capped.elements) {
      const ref = c.refs.get(el.token);
      if (ref !== undefined) refs.set(el.token, ref);
    }
    this.#latest = { id, refs, ancestors: c.ancestors, secretTokens: c.secretTokens, invalidated: false };
    this.#lastStats = {
      ...c.timings,
      totalMs: Date.now() - t0,
      elementCount: capped.elements.length,
      omitted: capped.omitted,
      tokenEstimate: capped.tokenEstimate,
      oversized: capped.narrowed,
      degraded: c.degraded,
    };
    if (c.degraded) this.#log.warn({ snapshot: id }, "DOM enrichment unavailable; aria facts only");
    return ok(snapshot);
  }

  async screenshot(region?: Rect): Promise<Result<{ capture: Capture; data: Uint8Array }, ComputerError>> {
    try {
      const metrics = Metrics.parse(await this.#page.evaluate(viewportMetrics));
      const buf = await this.#page.screenshot({
        type: "png",
        timeout: this.#timeout,
        ...(region ? { clip: { x: region.x, y: region.y, width: region.width, height: region.height } } : {}),
      });
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const { width, height } = pngSize(data);
      const id = `c${++this.#captureSeq}`;
      const capture: Capture = {
        id,
        ...(this.#latest ? { snapshotId: this.#latest.id } : {}),
        takenAt: Date.now(),
        mimeType: "image/png",
        width,
        height,
        scale: metrics.dpr,
        ...(region ? { region } : {}),
      };
      this.#captures.set(id, {
        scale: metrics.dpr,
        region,
        scrollX: metrics.scrollX,
        scrollY: metrics.scrollY,
      });
      if (this.#captures.size > MAX_CAPTURES) {
        const oldest = this.#captures.keys().next().value;
        if (oldest !== undefined) this.#captures.delete(oldest);
      }
      return ok({ capture, data });
    } catch (e) {
      return err({ kind: this.#page.isClosed() ? "closed" : "driver", message: firstLine(e) });
    }
  }

  // ---- verify ----------------------------------------------------------------------------------

  async verify(predicates: Predicate[]): Promise<PredicateResult[]> {
    // A private snapshot: it does not replace the latest one, so tokens stay valid.
    const cap = await captureSnapshot({
      page: this.#page,
      scope: this.#scope,
      snapshotId: "v0",
      timeoutMs: this.#timeout,
    });
    if (!cap.ok)
      return predicates.map((p) => ({ predicate: p, state: "unknown", detail: cap.error.message }));
    const c = cap.value;
    const snapshot: Snapshot = {
      id: "v0",
      surface: "web",
      takenAt: Date.now(),
      url: c.url,
      title: c.title,
      viewport: c.viewport,
      elements: c.elements,
      text: c.text,
      tokenEstimate: 0,
      quality: measureQuality(c.elements),
      narrowed: false,
    };
    return predicates.map((p) => {
      const state = evaluateDeterministic(p, snapshot);
      if (state !== undefined) return { predicate: p, state };
      return {
        predicate: p,
        state: "unknown",
        detail: p.kind === "oracle" ? "needs the testbed oracle" : "needs a decision model",
      };
    });
  }

  // ---- recording -------------------------------------------------------------------------------

  async startRecording(dir: string): Promise<Result<void, ComputerError>> {
    if (this.#recordingDir !== undefined) return err({ kind: "driver", message: "already recording" });
    try {
      mkdirSync(dir, { recursive: true });
      await this.#context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      this.#recordingDir = dir;
      return ok(undefined);
    } catch (e) {
      return err({ kind: "driver", message: `cannot start tracing: ${firstLine(e)}` });
    }
  }

  async stopRecording(): Promise<Result<{ files: string[] }, ComputerError>> {
    const dir = this.#recordingDir;
    if (dir === undefined) return err({ kind: "driver", message: "not recording" });
    this.#recordingDir = undefined;
    const path = join(dir, "trace.zip");
    try {
      await this.#context.tracing.stop({ path });
    } catch (e) {
      return err({ kind: "driver", message: `cannot stop tracing: ${firstLine(e)}` });
    }
    const redacted = redactZip(path, this.#scope.values());
    if (!redacted.ok) {
      // Fail closed: a trace that may hold secrets is not kept.
      rmSync(path, { force: true });
      return err({ kind: "driver", message: `trace removed, redaction failed: ${redacted.error}` });
    }
    return ok({ files: [path] });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#recordingDir !== undefined) await this.stopRecording();
    this.#detach(this.#page);
    this.#context.off("page", this.#onPopup);
    await this.#context.unroute("**/*", this.#onRoute).catch(() => {});
    if (this.#closeContext) await this.#context.close().catch(() => {});
  }

  // ---- token resolution, refusals --------------------------------------------------------------

  #result(
    effect: ActionResult["effect"],
    route: ActionRoute,
    start: number,
    evidence: Evidence[],
    invalidated: boolean,
    error?: { kind: ActionErrorKind; message: string },
  ): ActionResult {
    const latest = this.#latest;
    return {
      effect,
      route,
      evidence,
      ...(error ? { error: { kind: error.kind, message: this.#scope.redact(error.message) } } : {}),
      invalidatedSnapshots: invalidated && latest ? [latest.id] : [],
      durationMs: Date.now() - start,
    };
  }

  #refuse(
    kind: ActionErrorKind,
    message: string,
    route: ActionRoute,
    start: number,
    evidence: Evidence[] = [],
  ): ActionResult {
    return this.#result("refused", route, start, evidence, false, { kind, message });
  }

  #invalidate(): void {
    if (this.#latest) this.#latest.invalidated = true;
  }

  /** Freshness check: only tokens of the latest, not yet invalidated snapshot are accepted. Never re-resolves. */
  async #resolveToken(
    token: string,
  ): Promise<{ ok: true; target: ResolvedTarget } | { ok: false; why: string }> {
    const m = TOKEN.exec(token);
    const latest = this.#latest;
    if (!m?.[1] || !m[2]) return { ok: false, why: `"${token}" is not a token of this driver` };
    if (!latest) return { ok: false, why: "no snapshot has been taken" };
    if (m[2] !== latest.id)
      return { ok: false, why: `token from snapshot ${m[2]}; the latest is ${latest.id}` };
    if (latest.invalidated)
      return { ok: false, why: `snapshot ${latest.id} was invalidated by an earlier action; observe again` };
    const ref = latest.refs.get(token);
    if (ref === undefined) return { ok: false, why: `token ${token} is not in snapshot ${latest.id}` };
    const locator = this.#page.locator(`aria-ref=${ref}`);
    let count = 0;
    try {
      count = await locator.count();
    } catch {
      count = 0;
    }
    if (count !== 1) return { ok: false, why: `the element of ${token} is no longer in the page` };
    return { ok: true, target: { ref, token, locator, secretField: latest.secretTokens.has(token) } };
  }

  async #probe(locator: Locator): Promise<TargetObservation> {
    try {
      if ((await locator.count()) === 0) return "gone";
      const raw = await locator.evaluate(probeTarget, undefined, { timeout: 1000 });
      const parsed = TargetProbeSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return (await locator.count().catch(() => 0)) === 0 ? "gone" : undefined;
    }
  }

  async #observePage(): Promise<PageObservation> {
    return {
      url: this.#page.url(),
      state: await this.#pageState(),
      navigations: this.#navigations,
      jsDialogs: this.#jsDialogs,
      popups: this.#popups.length,
      requests: this.#tracker.state().started,
    };
  }

  #errorKind(e: unknown): ActionErrorKind {
    const message = firstLine(e);
    if ((e instanceof Error && e.name === "TimeoutError") || /Timeout \d+ms exceeded/.test(message))
      return "timeout";
    if (
      /not an? <|not editable|not a checkbox|not a select|disabled|Cannot uncheck|not visible|outside of the viewport/i.test(
        message,
      )
    )
      return "not_interactable";
    return "driver";
  }

  #redactValue(secretField: boolean): (v: string | undefined) => string {
    return (v) => {
      if (v === undefined) return "unset";
      if (v.length === 0) return "<empty>";
      const name = this.#scope.match(v);
      if (name !== undefined) return secretPlaceholder(name);
      if (secretField) return "<filled>";
      const r = this.#scope.redact(v.replace(/\s+/g, " ").trim());
      return r.length > 80 ? `${r.slice(0, 79)}…` : r;
    };
  }

  /** Runs one action: freshness, hit test, before read-back, action, settle, origin re-check, after read-back. */
  async #perform(spec: ActionSpec): Promise<ActionResult> {
    const start = Date.now();
    if (this.#closed) return this.#refuse("driver", "the computer is closed", spec.route, start);
    let target: ResolvedTarget | undefined;
    if (spec.token !== undefined) {
      const resolved = await this.#resolveToken(spec.token);
      if (!resolved.ok) return this.#refuse("stale_token", resolved.why, spec.route, start);
      target = resolved.target;
    }
    if (target && spec.pointer) {
      const hit = await this.#hitTest(target.locator);
      if (!hit.ok)
        return this.#refuse(
          "hit_test_failed",
          `the target is covered at its center by ${hit.hit}`,
          spec.route,
          start,
          [{ kind: "dom", detail: `element at (${Math.round(hit.x)}, ${Math.round(hit.y)}): ${hit.hit}` }],
        );
    }
    const pageBefore = await this.#observePage();
    const before: TargetObservation = target ? await this.#probe(target.locator) : undefined;
    const blockedBefore = this.#blocked.length;
    const popupsBefore = this.#popups.length;
    try {
      await spec.run({ locator: target?.locator, before });
    } catch (e) {
      const kind = this.#errorKind(e);
      if (kind === "timeout" || kind === "not_interactable")
        return this.#refuse(kind, firstLine(e), spec.route, start);
      if (spec.mutating) this.#invalidate();
      return this.#result("unverifiable", spec.route, start, [], spec.mutating, {
        kind,
        message: firstLine(e),
      });
    }
    if (spec.mutating) this.#invalidate();

    await this.waitIdle({ capMs: this.#effectCap });

    // Popups opened by the action: refuse disallowed ones, otherwise follow the newest.
    const opened = this.#popups.slice(popupsBefore);
    for (const popup of opened) {
      await popup.waitForLoadState("domcontentloaded", { timeout: this.#effectCap }).catch(() => {});
      if (!this.#guard.check(popup.url()).allowed) await popup.close().catch(() => {});
    }
    const live = opened.filter((p) => !p.isClosed());
    const newest = live[live.length - 1];
    if (newest) {
      this.#switchTo(newest);
      await this.waitIdle({ capMs: this.#effectCap });
    }

    // Origin re-check after any navigation.
    const blockedTop = this.#blocked.slice(blockedBefore).filter((b) => b.topLevel);
    const here = this.#page.url();
    if (!this.#guard.check(here).allowed) {
      const leftFrom = here;
      await this.#leaveDisallowed();
      return this.#result(
        "refused",
        spec.route,
        start,
        [
          {
            kind: "url",
            before: this.#scope.redact(pageBefore.url),
            after: this.#scope.redact(this.#page.url()),
            detail: `left disallowed origin ${safeOrigin(leftFrom)}`,
          },
        ],
        spec.mutating,
        { kind: "origin_blocked", message: `navigation to ${safeOrigin(leftFrom)} is not allowed` },
      );
    }
    if (blockedTop.length > 0 || opened.length > live.length) {
      const origin = safeOrigin(blockedTop[0]?.url ?? "");
      return this.#result(
        "refused",
        spec.route,
        start,
        [{ kind: "network", detail: `blocked navigation to ${origin}` }],
        spec.mutating,
        { kind: "origin_blocked", message: `navigation to ${origin} is not allowed` },
      );
    }

    const pageAfter = await this.#observePage();
    const after: TargetObservation = target ? await this.#probe(target.locator) : undefined;
    const judged = spec.judge({
      pageBefore,
      pageAfter,
      before,
      after,
      secretField: target?.secretField ?? false,
    });
    return this.#result(judged.effect, spec.route, start, judged.evidence, spec.mutating);
  }

  async #hitTest(locator: Locator): Promise<HitTestResult> {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: this.#timeout });
      const raw = await locator.evaluate(hitTestTarget, undefined, { timeout: this.#timeout });
      const parsed = HitTestResult.safeParse(raw);
      return parsed.success ? parsed.data : { ok: false, hit: "unreadable hit test", x: 0, y: 0 };
    } catch (e) {
      return { ok: false, hit: `hit test failed: ${firstLine(e)}`, x: 0, y: 0 };
    }
  }

  async #leaveDisallowed(): Promise<void> {
    await this.#page.goBack({ timeout: this.#timeout, waitUntil: "domcontentloaded" }).catch(() => null);
    if (this.#guard.check(this.#page.url()).allowed) return;
    const fallback = this.#lastAllowedUrl ?? "about:blank";
    await this.#page
      .goto(fallback, { timeout: this.#timeout, waitUntil: "domcontentloaded" })
      .catch(() => null);
  }

  #defaultJudge(redactValue: (v: string | undefined) => string) {
    return (j: Judgement) =>
      assess(
        [
          ...pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s)),
          ...targetEvidence(j.before, j.after, redactValue),
        ],
        weakEvidence(j.pageBefore, j.pageAfter),
      );
  }

  // ---- semantic actions ------------------------------------------------------------------------

  press(token: string): Promise<ActionResult> {
    return this.#perform({
      route: "semantic",
      token,
      pointer: true,
      mutating: true,
      run: async ({ locator }) => {
        await locator?.click({ timeout: this.#timeout });
      },
      judge: this.#defaultJudge(this.#redactValue(false)),
    });
  }

  setValue(token: string, value: FieldValue): Promise<ActionResult> {
    return this.#fill(token, value, "semantic");
  }

  /** Types a registered secret into a field. Only on allowlisted origins. */
  async fillCredential(token: string, name: string): Promise<ActionResult> {
    const start = Date.now();
    const guard = this.#credentialGuard(start);
    if (guard) return guard;
    return this.#fill(token, { secretRef: name }, "tool");
  }

  /** Types a TOTP code generated from a registered base32 secret. Only on allowlisted origins. */
  async fillTotp(token: string, name: string): Promise<ActionResult> {
    const start = Date.now();
    const guard = this.#credentialGuard(start);
    if (guard) return guard;
    const secret = this.#scope.resolve(name);
    if (secret === undefined) return this.#refuse("secret_missing", `no secret named ${name}`, "tool", start);
    const code = generateTotp(secret);
    if (!code.ok) return this.#refuse("secret_missing", `${name}: ${code.error}`, "tool", start);
    const codeName = `${name}.totp`;
    this.#scope.remember(codeName, code.value);
    return this.#fillText(token, code.value, codeName, "tool");
  }

  #credentialGuard(start: number): ActionResult | undefined {
    const url = this.#page.url();
    if (!this.#guard.hasAllowlist)
      return this.#refuse("origin_blocked", "credentials need an allowlist; none is set", "tool", start);
    if (!this.#guard.check(url).allowed || !/^https?:/.test(url))
      return this.#refuse(
        "origin_blocked",
        `credentials are not filled on ${safeOrigin(url)}`,
        "tool",
        start,
      );
    return undefined;
  }

  #fill(token: string, value: FieldValue, route: ActionRoute): Promise<ActionResult> {
    if (typeof value === "string") return this.#fillText(token, value, undefined, route);
    const resolved = this.#scope.resolve(value.secretRef);
    if (resolved === undefined)
      return Promise.resolve(
        this.#refuse("secret_missing", `no secret named ${value.secretRef}`, route, Date.now()),
      );
    return this.#fillText(token, resolved, value.secretRef, route);
  }

  #fillText(
    token: string,
    text: string,
    secretName: string | undefined,
    route: ActionRoute,
  ): Promise<ActionResult> {
    return this.#perform({
      route,
      token,
      mutating: true,
      run: async ({ locator }) => {
        await locator?.fill(text, { timeout: this.#timeout });
      },
      judge: (j) => {
        const redact = this.#redactValue(j.secretField || secretName !== undefined);
        const page = pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s));
        const after = j.after;
        if (after === "gone" || after === undefined)
          return {
            effect: "unverifiable",
            evidence: [...page, { kind: "value", detail: "field not readable after the action" }],
          };
        const before = j.before !== "gone" && j.before !== undefined ? j.before.value : undefined;
        const evidence: Evidence = { kind: "value", before: redact(before), after: redact(after.value) };
        if (after.value === text) {
          if (secretName !== undefined) evidence.detail = "secret value set (length matches)";
          return { effect: "confirmed", evidence: [evidence, ...page] };
        }
        if (after.value !== before)
          return {
            effect: "partial",
            evidence: [{ ...evidence, detail: "value differs from the requested one" }, ...page],
          };
        return { effect: "suspected_noop", evidence: [{ ...evidence, detail: "value unchanged" }, ...page] };
      },
    });
  }

  toggle(token: string, checked?: boolean): Promise<ActionResult> {
    let desired = checked ?? true;
    return this.#perform({
      route: "semantic",
      token,
      pointer: true,
      mutating: true,
      run: async ({ locator, before }) => {
        const current = before !== "gone" && before !== undefined ? before.checked : undefined;
        desired = checked ?? current !== true;
        await locator?.setChecked(desired, { timeout: this.#timeout });
      },
      judge: (j) => {
        const page = pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s));
        const b = j.before !== "gone" && j.before !== undefined ? j.before.checked : undefined;
        const a = j.after !== "gone" && j.after !== undefined ? j.after.checked : undefined;
        const evidence: Evidence = {
          kind: "state",
          before: `checked=${String(b)}`,
          after: `checked=${String(a)}`,
        };
        if (a === desired)
          return {
            effect: "confirmed",
            evidence: [
              b === desired ? { ...evidence, detail: "already in the requested state" } : evidence,
              ...page,
            ],
          };
        if (a !== b) return { effect: "partial", evidence: [evidence, ...page] };
        return { effect: "suspected_noop", evidence: [evidence, ...page] };
      },
    });
  }

  selectOption(token: string, option: string): Promise<ActionResult> {
    const wanted = norm(option);
    return this.#perform({
      route: "semantic",
      token,
      mutating: true,
      run: async ({ locator, before }) => {
        if (!locator) return;
        const tag = before !== "gone" && before !== undefined ? before.tag : "";
        if (tag === "select") {
          const labels = await locator.evaluate((el) =>
            el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => o.label || o.text) : [],
          );
          const index = labels.findIndex((l) => norm(l) === wanted);
          if (index < 0) throw new Error(`not a select option: no option labelled "${option}"`);
          await locator.selectOption({ index }, { timeout: this.#timeout });
          return;
        }
        // ARIA combobox/listbox: open it, then pick the option by role and name.
        await locator.click({ timeout: this.#timeout });
        await this.#page
          .getByRole("option", { name: option, exact: true })
          .first()
          .click({ timeout: this.#timeout });
      },
      judge: (j) => {
        const page = pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s));
        const redact = this.#redactValue(false);
        const b = j.before !== "gone" && j.before !== undefined ? j.before.value : undefined;
        const a = j.after !== "gone" && j.after !== undefined ? j.after : undefined;
        const evidence: Evidence = { kind: "value", before: redact(b), after: redact(a?.value) };
        const chosen =
          (a?.selectedLabels ?? []).some((l) => norm(l) === wanted) || norm(a?.value ?? "").includes(wanted);
        if (chosen) return { effect: "confirmed", evidence: [evidence, ...page] };
        if (a?.value !== b) return { effect: "partial", evidence: [evidence, ...page] };
        return { effect: "suspected_noop", evidence: [evidence, ...page] };
      },
    });
  }

  focus(token: string): Promise<ActionResult> {
    return this.#perform({
      route: "semantic",
      token,
      mutating: false,
      run: async ({ locator }) => {
        await locator?.focus({ timeout: this.#timeout });
      },
      judge: (j) => {
        const b = j.before !== "gone" && j.before !== undefined && j.before.focused;
        const a = j.after !== "gone" && j.after !== undefined && j.after.focused;
        const evidence: Evidence = { kind: "state", before: `focused=${b}`, after: `focused=${a}` };
        return { effect: a ? "confirmed" : "suspected_noop", evidence: [evidence] };
      },
    });
  }

  scrollIntoView(token: string): Promise<ActionResult> {
    return this.#perform({
      route: "semantic",
      token,
      mutating: false,
      run: async ({ locator }) => {
        await locator?.scrollIntoViewIfNeeded({ timeout: this.#timeout });
      },
      judge: (j) => {
        const b = j.before !== "gone" && j.before !== undefined && j.before.inViewport;
        const a = j.after !== "gone" && j.after !== undefined && j.after.inViewport;
        const evidence: Evidence = { kind: "state", before: `in_viewport=${b}`, after: `in_viewport=${a}` };
        return { effect: a ? "confirmed" : "suspected_noop", evidence: [evidence] };
      },
    });
  }

  // ---- pointer and keyboard --------------------------------------------------------------------

  /** Maps a coordinate target to a viewport point. */
  async #point(
    target: PointerTarget,
  ): Promise<{ ok: true; x: number; y: number } | { ok: false; kind: ActionErrorKind; why: string }> {
    if ("captureId" in target) {
      const cap = this.#captures.get(target.captureId);
      if (!cap) return { ok: false, kind: "stale_token", why: `unknown capture ${target.captureId}` };
      const m = Metrics.parse(await this.#page.evaluate(viewportMetrics));
      return {
        ok: true,
        x: target.x / cap.scale + (cap.region?.x ?? 0) + (cap.scrollX - m.scrollX),
        y: target.y / cap.scale + (cap.region?.y ?? 0) + (cap.scrollY - m.scrollY),
      };
    }
    if ("screenX" in target) {
      // Approximate: window position plus browser chrome (identity for headless browsers).
      const m = Metrics.parse(await this.#page.evaluate(viewportMetrics));
      const border = Math.max(0, (m.outerWidth - m.innerWidth) / 2);
      const top = Math.max(0, m.outerHeight - m.innerHeight - border);
      return { ok: true, x: target.screenX - m.screenX - border, y: target.screenY - m.screenY - top };
    }
    return { ok: false, kind: "unsupported", why: "token targets are resolved separately" };
  }

  async #pointAction(
    target: PointerTarget,
    route: ActionRoute,
    mutating: boolean,
    run: (p: { x: number; y: number }) => Promise<void>,
    judge?: (
      j: Judgement,
      p: { x: number; y: number },
    ) => { effect: ActionResult["effect"]; evidence: Evidence[] },
  ): Promise<ActionResult> {
    const start = Date.now();
    const point = await this.#point(target);
    if (!point.ok) return this.#refuse(point.kind, point.why, route, start);
    const p = { x: point.x, y: point.y };
    const at = await this.#page.evaluate(describePoint, p).catch(() => "unknown");
    const result = await this.#perform({
      route,
      mutating,
      run: () => run(p),
      judge: (j) => {
        if (judge) return judge(j, p);
        const strong = pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s));
        // Without a target, any DOM change is the best evidence there is.
        return assess(
          [...strong, ...weakEvidence(j.pageBefore, j.pageAfter).filter((e) => e.kind === "dom")],
          weakEvidence(j.pageBefore, j.pageAfter).filter((e) => e.kind !== "dom"),
        );
      },
    });
    return {
      ...result,
      evidence: [
        {
          kind: "dom",
          detail: `pointer at (${Math.round(p.x)}, ${Math.round(p.y)}) on ${this.#scope.redact(at)}`,
        },
        ...result.evidence,
      ],
    };
  }

  click(
    target: PointerTarget,
    opts?: { button?: "left" | "right" | "middle"; count?: number },
  ): Promise<ActionResult> {
    const button = opts?.button ?? "left";
    const clickCount = opts?.count ?? 1;
    if ("token" in target)
      return this.#perform({
        route: "pointer",
        token: target.token,
        pointer: true,
        mutating: true,
        run: async ({ locator }) => {
          await locator?.click({ button, clickCount, timeout: this.#timeout });
        },
        judge: this.#defaultJudge(this.#redactValue(false)),
      });
    return this.#pointAction(target, "pointer", true, (p) =>
      this.#page.mouse.click(p.x, p.y, { button, clickCount }),
    );
  }

  move(target: PointerTarget): Promise<ActionResult> {
    if ("token" in target)
      return this.#perform({
        route: "pointer",
        token: target.token,
        pointer: true,
        mutating: false,
        run: async ({ locator }) => {
          await locator?.hover({ timeout: this.#timeout });
        },
        judge: (j) => {
          const hovered = j.after !== "gone" && j.after !== undefined && j.after.hovered;
          const strong = pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s));
          return hovered
            ? { effect: "confirmed", evidence: [{ kind: "state", after: "hovered=true" }, ...strong] }
            : assess(strong, weakEvidence(j.pageBefore, j.pageAfter));
        },
      });
    return this.#pointAction(
      target,
      "pointer",
      false,
      (p) => this.#page.mouse.move(p.x, p.y),
      () => ({ effect: "unverifiable", evidence: [] }),
    ).then(async (r) => {
      if (r.effect !== "unverifiable") return r;
      const point = await this.#point(target);
      const hovered = point.ok
        ? await this.#page.evaluate(hoveredAt, { x: point.x, y: point.y }).catch(() => false)
        : false;
      return hovered
        ? { ...r, effect: "confirmed", evidence: [...r.evidence, { kind: "state", after: "hovered=true" }] }
        : r;
    });
  }

  async drag(from: PointerTarget, to: PointerTarget): Promise<ActionResult> {
    const start = Date.now();
    if ("token" in from && "token" in to) {
      const dest = await this.#resolveToken(to.token);
      if (!dest.ok) return this.#refuse("stale_token", dest.why, "pointer", start);
      const destBefore = await this.#probe(dest.target.locator);
      const result = await this.#perform({
        route: "pointer",
        token: from.token,
        pointer: true,
        mutating: true,
        run: async ({ locator }) => {
          await locator?.dragTo(dest.target.locator, { timeout: this.#timeout });
        },
        judge: (j) =>
          assess(
            [
              ...pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s)),
              ...targetEvidence(j.before, j.after, this.#redactValue(false)),
            ],
            weakEvidence(j.pageBefore, j.pageAfter),
          ),
      });
      if (result.effect !== "partial" && result.effect !== "suspected_noop") return result;
      // The drop target may be where the change shows.
      const destAfter = await this.#probe(dest.target.locator);
      const extra = targetEvidence(destBefore, destAfter, this.#redactValue(false));
      return extra.length > 0
        ? {
            ...result,
            effect: "confirmed",
            evidence: [
              ...extra.map((e) => ({ ...e, detail: `drop target: ${e.detail ?? e.kind}` })),
              ...result.evidence,
            ],
          }
        : result;
    }
    const a = "token" in from ? await this.#tokenCenter(from.token) : await this.#point(from);
    const b = "token" in to ? await this.#tokenCenter(to.token) : await this.#point(to);
    if (!a.ok) return this.#refuse(a.kind, a.why, "pointer", start);
    if (!b.ok) return this.#refuse(b.kind, b.why, "pointer", start);
    return this.#perform({
      route: "pointer",
      mutating: true,
      run: async () => {
        await this.#page.mouse.move(a.x, a.y);
        await this.#page.mouse.down();
        await this.#page.mouse.move(b.x, b.y, { steps: 10 });
        await this.#page.mouse.up();
      },
      judge: (j) => {
        const strong = pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s));
        const weak = weakEvidence(j.pageBefore, j.pageAfter);
        return assess(
          [...strong, ...weak.filter((e) => e.kind === "dom")],
          weak.filter((e) => e.kind !== "dom"),
        );
      },
    });
  }

  async #tokenCenter(
    token: string,
  ): Promise<{ ok: true; x: number; y: number } | { ok: false; kind: ActionErrorKind; why: string }> {
    const resolved = await this.#resolveToken(token);
    if (!resolved.ok) return { ok: false, kind: "stale_token", why: resolved.why };
    const hit = await this.#hitTest(resolved.target.locator);
    if (!hit.ok) return { ok: false, kind: "hit_test_failed", why: `the target is covered by ${hit.hit}` };
    // Hit-test coordinates are frame-relative; only top-document targets map directly to the viewport.
    if (resolved.target.ref.startsWith("f"))
      return { ok: false, kind: "unsupported", why: "coordinate drag inside frames" };
    return { ok: true, x: hit.x, y: hit.y };
  }

  async scroll(dx: number, dy: number, target?: PointerTarget): Promise<ActionResult> {
    const start = Date.now();
    let point: { x: number; y: number } | null = null;
    if (target) {
      const p = "token" in target ? await this.#tokenCenter(target.token) : await this.#point(target);
      if (!p.ok) return this.#refuse(p.kind, p.why, "pointer", start);
      point = { x: p.x, y: p.y };
    } else {
      const m = Metrics.parse(await this.#page.evaluate(viewportMetrics));
      point = { x: m.innerWidth / 2, y: m.innerHeight / 2 };
    }
    const at = point;
    const before = await this.#page.evaluate(scrollState, at).catch(() => "");
    return this.#perform({
      route: "pointer",
      mutating: false,
      run: async () => {
        await this.#page.mouse.move(at.x, at.y);
        await this.#page.mouse.wheel(dx, dy);
        await sleep(100);
      },
      judge: () => ({ effect: "unverifiable", evidence: [] }),
    }).then(async (r) => {
      if (r.effect !== "unverifiable" || r.error) return r;
      const after = await this.#page.evaluate(scrollState, at).catch(() => "");
      const evidence: Evidence = { kind: "state", before: `scroll=${before}`, after: `scroll=${after}` };
      return { ...r, effect: before !== after ? "confirmed" : "suspected_noop", evidence: [evidence] };
    });
  }

  async typeText(text: FieldValue): Promise<ActionResult> {
    const start = Date.now();
    let value: string;
    let secretName: string | undefined;
    if (typeof text === "string") value = text;
    else {
      const resolved = this.#scope.resolve(text.secretRef);
      if (resolved === undefined)
        return this.#refuse("secret_missing", `no secret named ${text.secretRef}`, "keyboard", start);
      value = resolved;
      secretName = text.secretRef;
    }
    const before = FocusState.safeParse(await this.#page.evaluate(focusState).catch(() => null));
    return this.#perform({
      route: "keyboard",
      mutating: true,
      run: async () => {
        await this.#page.keyboard.type(value);
      },
      judge: () => ({ effect: "unverifiable", evidence: [] }),
    }).then(async (r) => {
      if (r.effect !== "unverifiable" || r.error) return r;
      const after = FocusState.safeParse(await this.#page.evaluate(focusState).catch(() => null));
      if (!before.success || !after.success) return r;
      const redact = this.#redactValue(secretName !== undefined || after.data.secret);
      const evidence: Evidence = {
        kind: "value",
        before: redact(before.data.value ?? undefined),
        after: redact(after.data.value ?? undefined),
        detail: `focused: ${this.#scope.redact(after.data.desc)}`,
      };
      const b = before.data.value ?? "";
      const a = after.data.value ?? "";
      if (a.includes(value) && a !== b) return { ...r, effect: "confirmed", evidence: [evidence] };
      if (a !== b) return { ...r, effect: "partial", evidence: [evidence] };
      return { ...r, effect: "suspected_noop", evidence: [evidence] };
    });
  }

  async key(keys: string[]): Promise<ActionResult> {
    const combo = keys.join("+");
    const before = FocusState.safeParse(await this.#page.evaluate(focusState).catch(() => null));
    return this.#perform({
      route: "keyboard",
      mutating: true,
      run: async () => {
        await this.#page.keyboard.press(combo);
      },
      judge: (j) => {
        const strong = pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s));
        const weak = weakEvidence(j.pageBefore, j.pageAfter);
        return assess(
          [...strong, ...weak.filter((e) => e.kind === "dom")],
          weak.filter((e) => e.kind !== "dom"),
        );
      },
    }).then(async (r) => {
      if (r.error || r.effect === "confirmed") return r;
      const after = FocusState.safeParse(await this.#page.evaluate(focusState).catch(() => null));
      if (!before.success || !after.success) return r;
      if (before.data.desc !== after.data.desc || before.data.value !== after.data.value) {
        const evidence: Evidence = {
          kind: "state",
          before: `focus=${this.#scope.redact(before.data.desc)}`,
          after: `focus=${this.#scope.redact(after.data.desc)}`,
        };
        return {
          ...r,
          effect: "confirmed",
          evidence: [evidence, ...r.evidence.filter((e) => e.kind !== "none")],
        };
      }
      return r;
    });
  }

  // ---- navigation helpers ----------------------------------------------------------------------

  async navigate(url: string): Promise<ActionResult> {
    const start = Date.now();
    const decision = this.#guard.check(url);
    if (!decision.allowed)
      return this.#refuse(
        "origin_blocked",
        `navigation to ${safeOrigin(url)} is not allowed (${decision.reason})`,
        "navigation",
        start,
      );
    return this.#perform({
      route: "navigation",
      mutating: true,
      run: async () => {
        await this.#page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: Math.max(this.#timeout, 15_000),
        });
      },
      judge: (j) =>
        assess(
          pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s)),
          weakEvidence(j.pageBefore, j.pageAfter),
        ),
    });
  }

  back(): Promise<ActionResult> {
    return this.#perform({
      route: "navigation",
      mutating: true,
      run: async () => {
        await this.#page.goBack({ waitUntil: "domcontentloaded", timeout: Math.max(this.#timeout, 15_000) });
      },
      judge: (j) =>
        assess(
          pageEvidence(j.pageBefore, j.pageAfter, (s) => this.#scope.redact(s)),
          weakEvidence(j.pageBefore, j.pageAfter),
        ),
    });
  }
}

function safeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === "null" ? u.protocol : u.origin;
  } catch {
    return "an invalid URL";
  }
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}
