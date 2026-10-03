// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The desktop `Computer`: maps the protocol interface onto a native host over JSON-RPC. Owns tokens and
// freshness (only the latest snapshot's tokens act; never re-resolved), redaction, pointer coordinate
// mapping (token bounds, capture pixels, screen units) and effect judgement from the host's read-backs.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@ghosthand/core";
import { evaluateDeterministic, noopLogger, SecretsRegistry, secretPlaceholder } from "@ghosthand/core";
import type {
  ActionErrorKind,
  ActionResult,
  ActionRoute,
  ActOp,
  ActResult,
  Capture,
  Computer,
  ComputerCapabilities,
  ComputerError,
  DoctorCheck,
  Effect,
  Element,
  Evidence,
  FieldValue,
  HelloResult,
  InputParams,
  InputResult,
  ObserveScope,
  PointerTarget,
  Predicate,
  PredicateResult,
  Rect,
  Result,
  RpcSnapshot,
  Snapshot,
  SurfaceKind,
} from "@ghosthand/protocol";
import { err, ok, Region } from "@ghosthand/protocol";
import type { BuiltTable } from "./build-elements.ts";
import {
  buildElements,
  capElements,
  DESKTOP_TOKEN,
  estimateTableTokens,
  measureQuality,
} from "./build-elements.ts";
import { assess, targetEvidence, weakEvidence, windowEvidence } from "./desktop-effects.ts";
import type { RpcCallError, RpcTransport } from "./rpc/rpc-client.ts";

export interface DesktopApp {
  argv: string[];
  env?: Record<string, string>;
  cwd?: string;
  waitMs?: number;
}

/** Where the host writes files (recordings): its path for a folder the client can read. */
export interface SharedDir {
  hostPath: string;
  localPath: string;
}

export interface DesktopComputerOptions {
  transport: RpcTransport;
  hello: HelloResult;
  surface: Exclude<SurfaceKind, "web">;
  /** Launched by the first `open()` (any target), or by `open("app:<command>")`. */
  app?: DesktopApp;
  secrets?: SecretsRegistry;
  maxElements?: number;
  maxTokens?: number;
  shared?: SharedDir;
  logger?: Logger;
  /** Extra cleanup after the host closed (sandbox containers, temp folders). */
  onClose?: () => Promise<void>;
}

export interface DesktopObserveStats {
  totalMs: number;
  walkMs: number;
  nodeCount: number;
  elementCount: number;
  omitted: number;
  tokenEstimate: number;
  complete: boolean;
}

interface Latest {
  id: string;
  hostId: string;
  table: BuiltTable;
  byToken: Map<string, Element>;
  invalidated: boolean;
}

interface CaptureGeometry {
  scale: number;
  region: Rect | undefined;
}

const MAX_CAPTURES = 50;
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Splits a command line into argv: whitespace separates, single and double quotes group, backslash escapes. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | undefined;
  let has = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? "";
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"' && i + 1 < command.length) cur += command[++i] ?? "";
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < command.length) {
      cur += command[++i] ?? "";
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

export class DesktopComputer implements Computer {
  readonly #rpc: RpcTransport;
  readonly #hello: HelloResult;
  readonly #surface: Exclude<SurfaceKind, "web">;
  readonly #secrets: SecretsRegistry;
  readonly #app: DesktopApp | undefined;
  readonly #maxElements: number | undefined;
  readonly #maxTokens: number | undefined;
  readonly #shared: SharedDir | undefined;
  readonly #log: Logger;
  readonly #onClose: (() => Promise<void>) | undefined;
  #seq = 0;
  #captureSeq = 0;
  #latest: Latest | undefined;
  readonly #captures = new Map<string, CaptureGeometry>();
  #launched = false;
  #recording: string | undefined;
  #closed = false;
  #lastStats: DesktopObserveStats | undefined;

  constructor(opts: DesktopComputerOptions) {
    this.#rpc = opts.transport;
    this.#hello = opts.hello;
    this.#surface = opts.surface;
    this.#secrets = opts.secrets ?? new SecretsRegistry();
    this.#app = opts.app;
    this.#maxElements = opts.maxElements;
    this.#maxTokens = opts.maxTokens;
    this.#shared = opts.shared;
    this.#log = (opts.logger ?? noopLogger).child({ component: "desktop-computer" });
    this.#onClose = opts.onClose;
  }

  get platform(): HelloResult["platform"] {
    return this.#hello.platform;
  }

  /** noVNC live view on 127.0.0.1, when the sandbox runs one. */
  get vncUrl(): string | undefined {
    return this.#hello.capabilities.vncUrl;
  }

  get lastObserveStats(): DesktopObserveStats | undefined {
    return this.#lastStats;
  }

  capabilities(): ComputerCapabilities {
    const c = this.#hello.capabilities;
    return {
      surface: this.#surface,
      semanticActions: c.semanticActions,
      pointer: c.pointer,
      screenshots: c.screenshots,
      recording: c.recording,
    };
  }

  async doctor(): Promise<DoctorCheck[]> {
    const r = await this.#rpc.call("doctor", {});
    const host = {
      name: "desktop host",
      ok: r.ok,
      detail: `${this.#hello.host.name} ${this.#hello.host.version}`,
    };
    if (!r.ok) return [{ ...host, detail: r.error.message }];
    return [host, ...r.value.checks];
  }

  // ---- open / launch ---------------------------------------------------------------------------

  async open(target: string): Promise<Result<void, ComputerError>> {
    if (this.#closed) return err({ kind: "closed", message: "the computer is closed" });
    let app: DesktopApp | undefined;
    if (target.startsWith("app:")) {
      const argv = splitCommand(target.slice(4).trim());
      if (argv.length === 0) return err({ kind: "launch_failed", message: "empty app command" });
      app = { ...(this.#app ?? {}), argv };
    } else if (!this.#launched) app = this.#app;
    if (app === undefined) {
      await this.waitIdle();
      return ok(undefined);
    }
    const r = await this.#rpc.call(
      "launch",
      {
        argv: app.argv,
        ...(app.env ? { env: app.env } : {}),
        ...(app.cwd ? { cwd: app.cwd } : {}),
        ...(app.waitMs ? { waitMs: app.waitMs } : {}),
      },
      { timeoutMs: (app.waitMs ?? 15_000) + 10_000 },
    );
    if (!r.ok) return err({ kind: "launch_failed", message: this.#secrets.redact(r.error.message) });
    this.#launched = true;
    this.#invalidate();
    this.#log.info({ pid: r.value.pid }, "app launched");
    return ok(undefined);
  }

  async waitIdle(opts?: { capMs?: number }): Promise<{ waitedMs: number; reason: string }> {
    const r = await this.#rpc.call("wait_idle", { capMs: opts?.capMs ?? 3000, quietMs: 250 });
    return r.ok ? r.value : { waitedMs: 0, reason: `wait failed: ${r.error.message}` };
  }

  // ---- observe ---------------------------------------------------------------------------------

  #build(raw: RpcSnapshot, id: string): BuiltTable {
    return buildElements({
      snapshot: raw,
      platform: this.#hello.platform,
      boundsTrust: this.#hello.capabilities.boundsTrust,
      snapshotId: id,
      secrets: this.#secrets,
    });
  }

  async observe(scope?: ObserveScope): Promise<Result<Snapshot, ComputerError>> {
    if (this.#closed) return err({ kind: "closed", message: "the computer is closed" });
    const t0 = Date.now();
    const r = await this.#rpc.call("observe", { scope: "app" });
    if (!r.ok)
      return err({ kind: r.error.kind === "closed" ? "closed" : "driver", message: r.error.message });
    const raw = r.value;
    const id = `d${++this.#seq}`;
    const table = this.#build(raw, id);
    let elements = table.elements;
    let scopedTo: string | undefined;
    if (scope?.region !== undefined) {
      const region = scope.region;
      if (table.regions.some((g) => g.id === region)) {
        scopedTo = region;
        elements = elements.filter((e) => table.sections.get(e.token) === region);
      } else {
        const coarse = Region.safeParse(region);
        if (coarse.success) elements = elements.filter((e) => e.region === coarse.data);
        else {
          const ref = table.refs.get(region) ?? Number(DESKTOP_TOKEN.exec(region)?.[1] ?? Number.NaN);
          elements = elements.filter((e) => (table.ancestors.get(e.token) ?? []).includes(ref));
        }
      }
    }
    const capped = capElements(
      elements,
      table.text,
      scope?.maxElements ?? this.#maxElements,
      this.#maxTokens,
      scope?.focus ?? [],
    );
    const byToken = new Map<string, Element>();
    for (const el of capped.elements) byToken.set(el.token, el);
    this.#latest = { id, hostId: raw.snapshotId, table, byToken, invalidated: false };
    const title = this.#secrets.redact(raw.title || raw.appName || "");
    const snapshot: Snapshot = {
      id,
      surface: this.#surface,
      takenAt: raw.takenAt,
      title,
      viewport: raw.screen,
      elements: capped.elements,
      text: table.text,
      tokenEstimate: capped.tokenEstimate,
      quality: measureQuality(capped.elements),
      narrowed: capped.narrowed || scopedTo !== undefined,
      regions: table.regions,
      pageTokenEstimate: estimateTableTokens(table.elements, table.text),
      ...(scopedTo !== undefined ? { scope: scopedTo } : {}),
    };
    this.#lastStats = {
      totalMs: Date.now() - t0,
      walkMs: raw.walkMs ?? 0,
      nodeCount: raw.nodes.length,
      elementCount: capped.elements.length,
      omitted: capped.omitted,
      tokenEstimate: capped.tokenEstimate,
      complete: raw.complete,
    };
    if (!raw.complete) this.#log.warn({ reason: raw.degradedReason }, "accessibility tree incomplete");
    return ok(snapshot);
  }

  async screenshot(region?: Rect): Promise<Result<{ capture: Capture; data: Uint8Array }, ComputerError>> {
    const r = await this.#rpc.call("screenshot", region ? { region } : {}, { timeoutMs: 20_000 });
    if (!r.ok)
      return err({ kind: r.error.kind === "closed" ? "closed" : "driver", message: r.error.message });
    const data = new Uint8Array(Buffer.from(r.value.data, "base64"));
    const id = `c${++this.#captureSeq}`;
    const capture: Capture = {
      id,
      ...(this.#latest ? { snapshotId: this.#latest.id } : {}),
      takenAt: Date.now(),
      mimeType: r.value.mimeType,
      width: r.value.width,
      height: r.value.height,
      scale: r.value.scale,
      ...(region ? { region } : {}),
    };
    this.#captures.set(id, { scale: r.value.scale, region });
    if (this.#captures.size > MAX_CAPTURES) {
      const oldest = this.#captures.keys().next().value;
      if (oldest !== undefined) this.#captures.delete(oldest);
    }
    return ok({ capture, data });
  }

  // ---- verify ----------------------------------------------------------------------------------

  async verify(predicates: Predicate[]): Promise<PredicateResult[]> {
    const r = await this.#rpc.call("observe", { scope: "app", transient: true });
    if (!r.ok) return predicates.map((p) => ({ predicate: p, state: "unknown", detail: r.error.message }));
    const table = this.#build(r.value, "v0");
    const snapshot: Snapshot = {
      id: "v0",
      surface: this.#surface,
      takenAt: r.value.takenAt,
      title: this.#secrets.redact(r.value.title),
      viewport: r.value.screen,
      elements: table.elements,
      text: table.text,
      tokenEstimate: 0,
      quality: measureQuality(table.elements),
      narrowed: false,
    };
    return predicates.map((p) => {
      const state = evaluateDeterministic(p, snapshot);
      if (state !== undefined) return { predicate: p, state };
      return {
        predicate: p,
        state: "unknown",
        detail: p.kind === "oracle" ? "needs the task oracle" : "needs a decision model",
      };
    });
  }

  // ---- recording -------------------------------------------------------------------------------

  async startRecording(dir: string): Promise<Result<void, ComputerError>> {
    if (!this.#hello.capabilities.recording)
      return err({ kind: "driver", message: "recording is not available on this host" });
    if (this.#recording !== undefined) return err({ kind: "driver", message: "already recording" });
    const shared = this.#shared ?? { hostPath: dir, localPath: dir };
    const file = `recording-${Date.now()}.mp4`;
    const r = await this.#rpc.call("record_start", { path: joinHost(shared.hostPath, file) });
    if (!r.ok) return err({ kind: "driver", message: r.error.message });
    this.#recording = dir;
    this.#recordingFile = file;
    return ok(undefined);
  }

  #recordingFile: string | undefined;
  /** A secret went into a field that shows its text (not a password field) while recording. */
  #secretShown = false;

  async stopRecording(): Promise<Result<{ files: string[] }, ComputerError>> {
    const dir = this.#recording;
    const file = this.#recordingFile;
    if (dir === undefined || file === undefined) return err({ kind: "driver", message: "not recording" });
    this.#recording = undefined;
    this.#recordingFile = undefined;
    const r = await this.#rpc.call("record_stop", {}, { timeoutMs: 20_000 });
    if (!r.ok) return err({ kind: "driver", message: r.error.message });
    const shared = this.#shared ?? { hostPath: dir, localPath: dir };
    const local = join(shared.localPath, file);
    if (!existsSync(local)) return ok({ files: [] });
    if (this.#secretShown) {
      // Pixels cannot be redacted: a secret typed into a visible (non-password) field may be in the video.
      rmSync(local, { force: true });
      return err({ kind: "driver", message: "recording removed: a secret was typed into a visible field" });
    }
    const target = join(dir, "video.mp4");
    try {
      mkdirSync(dir, { recursive: true });
      if (local !== target) copyFileSync(local, target);
    } catch (e) {
      return err({
        kind: "driver",
        message: `cannot copy the recording: ${e instanceof Error ? e.message : e}`,
      });
    }
    return ok({ files: [target] });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#recording !== undefined) await this.stopRecording();
    await this.#rpc.close();
    await this.#onClose?.();
  }

  // ---- tokens and results ----------------------------------------------------------------------

  #invalidate(): void {
    if (this.#latest) this.#latest.invalidated = true;
  }

  #resolve(
    token: string,
  ): { ok: true; ref: number; el: Element; hostId: string } | { ok: false; why: string } {
    const m = DESKTOP_TOKEN.exec(token);
    const latest = this.#latest;
    if (!m?.[1] || !m[2]) return { ok: false, why: `"${token}" is not a token of this driver` };
    if (!latest) return { ok: false, why: "no snapshot has been taken" };
    if (m[2] !== latest.id)
      return { ok: false, why: `token from snapshot ${m[2]}; the latest is ${latest.id}` };
    if (latest.invalidated)
      return { ok: false, why: `snapshot ${latest.id} was invalidated by an earlier action; observe again` };
    const el = latest.byToken.get(token);
    const ref = latest.table.refs.get(token);
    if (!el || ref === undefined) return { ok: false, why: `token ${token} is not in snapshot ${latest.id}` };
    return { ok: true, ref, el, hostId: latest.hostId };
  }

  #result(
    effect: Effect,
    route: ActionRoute,
    start: number,
    evidence: Evidence[],
    invalidated: boolean,
    error?: { kind: ActionErrorKind; message: string },
  ): ActionResult {
    return {
      effect,
      route,
      evidence,
      ...(error ? { error: { kind: error.kind, message: this.#secrets.redact(error.message) } } : {}),
      invalidatedSnapshots: invalidated && this.#latest ? [this.#latest.id] : [],
      durationMs: Date.now() - start,
    };
  }

  #refuse(kind: ActionErrorKind, message: string, route: ActionRoute, start: number): ActionResult {
    return this.#result("refused", route, start, [], false, { kind, message });
  }

  #rpcFailure(e: RpcCallError, route: ActionRoute, start: number): ActionResult {
    // The host refuses before acting for these; anything else may have run (never retried).
    if (e.kind === "stale_token") return this.#refuse("stale_token", e.message, route, start);
    if (e.kind === "not_found") return this.#refuse("not_found", e.message, route, start);
    if (e.kind === "not_interactable" || e.kind === "permission_denied")
      return this.#refuse("not_interactable", e.message, route, start);
    if (e.kind === "unsupported") return this.#refuse("unsupported", e.message, route, start);
    this.#invalidate();
    const kind: ActionErrorKind = e.kind === "timeout" ? "timeout" : "driver";
    return this.#result("unverifiable", route, start, [], true, { kind, message: e.message });
  }

  #redact = (s: string): string => this.#secrets.redact(s);

  #redactValue(secret: boolean): (v: string | undefined) => string {
    return (v) => {
      if (v === undefined) return "unset";
      if (v.length === 0) return "<empty>";
      const name = this.#secrets.match(v);
      if (name !== undefined) return secretPlaceholder(name);
      if (secret) return "<filled>";
      const r = this.#secrets.redact(v.replace(/\s+/g, " ").trim());
      return r.length > 80 ? `${r.slice(0, 79)}…` : r;
    };
  }

  async #act(
    op: ActOp,
    token: string,
    extra: { value?: string; checked?: boolean; option?: string; text?: string },
    judge: (r: ActResult, secret: boolean) => { effect: Effect; evidence: Evidence[] },
    routeHint: ActionRoute = "semantic",
  ): Promise<ActionResult> {
    const start = Date.now();
    if (this.#closed) return this.#refuse("driver", "the computer is closed", routeHint, start);
    const resolved = this.#resolve(token);
    if (!resolved.ok) return this.#refuse("stale_token", resolved.why, routeHint, start);
    const secret = this.#latest?.table.secretTokens.has(token) ?? false;
    const r = await this.#rpc.call("act", { snapshotId: resolved.hostId, ref: resolved.ref, op, ...extra });
    if (!r.ok) return this.#rpcFailure(r.error, routeHint, start);
    const res = r.value;
    const route: ActionRoute = res.route === "none" ? routeHint : res.route;
    if (!res.ok && res.error) {
      const k = res.error.kind;
      if (k === "not_interactable" || k === "unsupported" || k === "not_found")
        return this.#refuse(k, res.error.message, route, start);
      this.#invalidate();
      return this.#result("unverifiable", route, start, [], true, {
        kind: k === "timeout" ? "timeout" : "driver",
        message: res.error.message,
      });
    }
    this.#invalidate();
    const judged = judge(res, secret);
    const evidence: Evidence[] = res.nativeRoute
      ? [...judged.evidence, { kind: "none", detail: `route ${res.nativeRoute}` }]
      : judged.evidence;
    return this.#result(judged.effect, route, start, evidence, true);
  }

  #defaultJudge(r: ActResult, secret: boolean): { effect: Effect; evidence: Evidence[] } {
    return assess(
      [
        ...windowEvidence(r.globalBefore, r.globalAfter, this.#redact),
        ...targetEvidence(r.before, r.after, this.#redactValue(secret), this.#redact),
      ],
      weakEvidence(r.globalBefore, r.globalAfter, this.#redact),
    );
  }

  // ---- semantic actions ------------------------------------------------------------------------

  press(token: string): Promise<ActionResult> {
    return this.#act("press", token, {}, (r, s) => this.#defaultJudge(r, s));
  }

  setValue(token: string, value: FieldValue): Promise<ActionResult> {
    let text: string;
    if (typeof value === "string") text = value;
    else {
      const resolved = this.#secrets.resolve(value.secretRef);
      if (resolved === undefined)
        return Promise.resolve(
          this.#refuse("secret_missing", `no secret named ${value.secretRef}`, "semantic", Date.now()),
        );
      text = resolved;
    }
    const secretName = typeof value === "string" ? undefined : value.secretRef;
    const isSecret = secretName !== undefined || this.#secrets.match(text) !== undefined;
    return this.#act("set_value", token, { value: text }, (r, secretField) => {
      if (isSecret && !secretField && this.#recording !== undefined) this.#secretShown = true;
      const redact = this.#redactValue(secretField || secretName !== undefined);
      const before = r.before;
      const after = r.after;
      if (after === null) return assess([{ kind: "dom", detail: "field removed after the action" }], []);
      const evidence: Evidence = {
        kind: "value",
        before:
          before?.valueLength !== undefined && before.value === undefined
            ? "<filled>"
            : redact(before?.value),
        after:
          after.valueLength !== undefined && after.value === undefined ? redact(text) : redact(after.value),
      };
      const matches =
        after.value !== undefined
          ? after.value === text
          : after.valueLength !== undefined && after.valueLength === text.length;
      if (matches) {
        if (after.value === undefined) evidence.detail = "secret value set (length matches)";
        return { effect: "confirmed", evidence: [evidence] };
      }
      const changed = before?.value !== after.value || before?.valueLength !== after.valueLength;
      if (changed)
        return {
          effect: "partial",
          evidence: [{ ...evidence, detail: "value differs from the requested one" }],
        };
      return { effect: "suspected_noop", evidence: [{ ...evidence, detail: "value unchanged" }] };
    });
  }

  toggle(token: string, checked?: boolean): Promise<ActionResult> {
    return this.#act("toggle", token, checked === undefined ? {} : { checked }, (r) => {
      const isOn = (p: ActResult["before"]) =>
        p !== null && (p.states.includes("checked") || p.states.includes("pressed"));
      const b = isOn(r.before);
      const a = isOn(r.after);
      const desired = checked ?? !b;
      const evidence: Evidence = { kind: "state", before: `checked=${b}`, after: `checked=${a}` };
      if (a === desired)
        return {
          effect: "confirmed",
          evidence: [b === desired ? { ...evidence, detail: "already in the requested state" } : evidence],
        };
      if (a !== b) return { effect: "partial", evidence: [evidence] };
      return { effect: "suspected_noop", evidence: [evidence] };
    });
  }

  selectOption(token: string, option: string): Promise<ActionResult> {
    return this.#act("select_option", token, { option }, (r) => {
      const pick = (p: ActResult["after"]) => p?.selectedOption ?? p?.value ?? p?.name;
      const b = pick(r.before);
      const a = pick(r.after);
      const evidence: Evidence = {
        kind: "value",
        before: this.#redact(b ?? "none"),
        after: this.#redact(a ?? "none"),
      };
      if (a !== undefined && norm(a) === norm(option)) return { effect: "confirmed", evidence: [evidence] };
      const strong = windowEvidence(r.globalBefore, r.globalAfter, this.#redact);
      if (a !== b || strong.length > 0) return { effect: "partial", evidence: [evidence, ...strong] };
      return { effect: "suspected_noop", evidence: [evidence] };
    });
  }

  focus(token: string): Promise<ActionResult> {
    return this.#act("focus", token, {}, (r) => {
      const a = r.after?.states.includes("focused") ?? false;
      const b = r.before?.states.includes("focused") ?? false;
      return {
        effect: a ? "confirmed" : "suspected_noop",
        evidence: [{ kind: "state", before: `focused=${b}`, after: `focused=${a}` }],
      };
    });
  }

  scrollIntoView(token: string): Promise<ActionResult> {
    return this.#act("scroll_into_view", token, {}, (r) => {
      const off = (p: ActResult["before"]) => p?.states.includes("offscreen") ?? false;
      if (off(r.before) && !off(r.after))
        return {
          effect: "confirmed",
          evidence: [{ kind: "state", before: "offscreen", after: "on screen" }],
        };
      if (!off(r.before) && !off(r.after))
        return { effect: "confirmed", evidence: [{ kind: "state", detail: "already on screen" }] };
      return { effect: "unverifiable", evidence: [] };
    });
  }

  selectText(token: string, text: string): Promise<ActionResult> {
    return this.#act("select_text", token, { text }, () => ({
      effect: "unverifiable",
      evidence: [{ kind: "state", detail: `selection of ${text.length} characters requested` }],
    }));
  }

  // ---- pointer and keyboard (fallback) ---------------------------------------------------------

  #point(
    target: PointerTarget,
  ): { ok: true; x: number; y: number } | { ok: false; kind: ActionErrorKind; why: string } {
    if ("token" in target) {
      const resolved = this.#resolve(target.token);
      if (!resolved.ok) return { ok: false, kind: "stale_token", why: resolved.why };
      const b = resolved.el.visibleBounds ?? resolved.el.bounds;
      if (!b) return { ok: false, kind: "not_interactable", why: "the element has no bounds" };
      if (resolved.el.boundsTrust !== "exact")
        return {
          ok: false,
          kind: "unsupported",
          why: "element bounds are not trusted on this surface; use a semantic action",
        };
      return { ok: true, x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    if ("captureId" in target) {
      const cap = this.#captures.get(target.captureId);
      if (!cap) return { ok: false, kind: "stale_token", why: `unknown capture ${target.captureId}` };
      const ox = cap.region?.x ?? 0;
      const oy = cap.region?.y ?? 0;
      return { ok: true, x: ox + target.x / cap.scale, y: oy + target.y / cap.scale };
    }
    return { ok: true, x: target.screenX, y: target.screenY };
  }

  async #input(
    params: InputParams,
    route: ActionRoute,
    judge: (r: InputResult) => { effect: Effect; evidence: Evidence[] },
  ): Promise<ActionResult> {
    const start = Date.now();
    if (this.#closed) return this.#refuse("driver", "the computer is closed", route, start);
    if (!this.#hello.capabilities.pointer)
      return this.#refuse("unsupported", "synthetic input is unavailable on this host", route, start);
    const r = await this.#rpc.call("input", params);
    if (!r.ok) return this.#rpcFailure(r.error, route, start);
    this.#invalidate();
    const judged = judge(r.value);
    return this.#result(judged.effect, route, start, judged.evidence, true);
  }

  #windowJudge = (r: InputResult): { effect: Effect; evidence: Evidence[] } =>
    assess(
      windowEvidence(r.globalBefore, r.globalAfter, this.#redact),
      weakEvidence(r.globalBefore, r.globalAfter, this.#redact),
    );

  async click(
    target: PointerTarget,
    opts?: { button?: "left" | "right" | "middle"; count?: number },
  ): Promise<ActionResult> {
    const p = this.#point(target);
    if (!p.ok) return this.#refuse(p.kind, p.why, "pointer", Date.now());
    return this.#input(
      {
        op: "click",
        x: p.x,
        y: p.y,
        ...(opts?.button ? { button: opts.button } : {}),
        ...(opts?.count ? { count: opts.count } : {}),
      },
      "pointer",
      this.#windowJudge,
    );
  }

  async move(target: PointerTarget): Promise<ActionResult> {
    const p = this.#point(target);
    if (!p.ok) return this.#refuse(p.kind, p.why, "pointer", Date.now());
    return this.#input({ op: "move", x: p.x, y: p.y }, "pointer", (r) => {
      const strong = windowEvidence(r.globalBefore, r.globalAfter, this.#redact);
      return strong.length > 0 ? assess(strong, []) : { effect: "unverifiable", evidence: [] };
    });
  }

  async drag(from: PointerTarget, to: PointerTarget): Promise<ActionResult> {
    const a = this.#point(from);
    if (!a.ok) return this.#refuse(a.kind, a.why, "pointer", Date.now());
    const b = this.#point(to);
    if (!b.ok) return this.#refuse(b.kind, b.why, "pointer", Date.now());
    return this.#input({ op: "drag", x: a.x, y: a.y, toX: b.x, toY: b.y }, "pointer", this.#windowJudge);
  }

  async scroll(dx: number, dy: number, target?: PointerTarget): Promise<ActionResult> {
    let at: { x: number; y: number } | undefined;
    if (target) {
      const p = this.#point(target);
      if (!p.ok) return this.#refuse(p.kind, p.why, "pointer", Date.now());
      at = { x: p.x, y: p.y };
    }
    return this.#input({ op: "scroll", dx, dy, ...(at ?? {}) }, "pointer", this.#windowJudge);
  }

  async typeText(text: FieldValue): Promise<ActionResult> {
    let value: string;
    if (typeof text === "string") value = text;
    else {
      const resolved = this.#secrets.resolve(text.secretRef);
      if (resolved === undefined)
        return this.#refuse("secret_missing", `no secret named ${text.secretRef}`, "keyboard", Date.now());
      value = resolved;
    }
    const secret = typeof text !== "string";
    const isSecret = secret || this.#secrets.match(value) !== undefined;
    return this.#input({ op: "type", text: value }, "keyboard", (r) => {
      const b = r.focusedBefore;
      const a = r.focusedAfter;
      if (isSecret && a?.valueLength === undefined && this.#recording !== undefined) this.#secretShown = true;
      const redact = this.#redactValue(secret);
      if (a?.value?.includes(value) && a.value !== b?.value)
        return {
          effect: "confirmed",
          evidence: [{ kind: "value", before: redact(b?.value), after: redact(a.value) }],
        };
      if (a?.valueLength !== undefined && a.valueLength - (b?.valueLength ?? 0) === value.length)
        return {
          effect: "confirmed",
          evidence: [
            { kind: "value", before: "<filled>", after: "<filled>", detail: "length grew by the typed text" },
          ],
        };
      if (a?.value !== b?.value || a?.valueLength !== b?.valueLength)
        return {
          effect: "partial",
          evidence: [{ kind: "value", before: redact(b?.value), after: redact(a?.value) }],
        };
      return this.#windowJudge(r);
    });
  }

  async key(keys: string[]): Promise<ActionResult> {
    return this.#input({ op: "key", keys }, "keyboard", (r) => {
      const strong = windowEvidence(r.globalBefore, r.globalAfter, this.#redact);
      const weak = weakEvidence(r.globalBefore, r.globalAfter, this.#redact);
      // A key that moves focus did something (Tab, arrows), like the web driver.
      const focusMoved = weak.filter((e) => e.kind === "state");
      return assess(
        [...strong, ...focusMoved],
        weak.filter((e) => e.kind !== "state"),
      );
    });
  }
}

/** Joins a host-side path (always POSIX inside containers; Windows hosts accept forward slashes). */
function joinHost(dir: string, file: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${file}`;
}
