// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Runs one QA case on the web: testbed setup (reset, seed, variant, sign-in), one recorded agent run whose
// plan is the case's steps, a checkpoint at every subgoal end, a final observation, axe audits, the
// driver's console/HTTP error log, thumbnails for the report and the oracle/HTTP checkers for the judge.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Predicate, type Result, type RunEvent } from "@ghosthand/protocol";
import type {
  CaseExecution,
  CaseExecutor,
  Checkpoint,
  ExecuteCaseInput,
  ExecuteError,
  QaSpec,
} from "@ghosthand/qa";
import { RecordingDecisionProvider } from "@ghosthand/qa";
import {
  CONTROL_ORIGIN,
  createControlClient,
  fixtureSecrets,
  getTask,
  isFixtureSecretName,
  listTaskIds,
  VariantOverrides,
} from "@ghosthand/testbed-kit";
import { QaProbeComputer } from "./qa-probe-computer.ts";
import { makeThumbnails } from "./qa-thumbnails.ts";
import { runAgent } from "./run-agent.ts";
import type { EngineRuntime } from "./runtime.ts";
import type { BrowserCookie } from "./testbed.ts";
import { launchWeb } from "./web-launcher.ts";

export type VariantValue = string | number | boolean;

export interface WebCaseExecutorOptions {
  spec: QaSpec;
  headless?: boolean;
  profile?: string;
  /** Variant flags merged over the spec's (e.g. `{ bug: "profile-title" }`). */
  variant?: Record<string, VariantValue>;
  /** Run axe on every visited page (default true). */
  a11y?: boolean;
  controlOrigin?: string;
  appOrigin?: string;
  trace?: boolean;
}

/** The testbed variant a spec runs with: task setup, then front-matter, then overrides. */
export function effectiveVariant(
  spec: QaSpec,
  overrides: Record<string, VariantValue> = {},
): Record<string, VariantValue> {
  const tb = spec.frontMatter.testbed;
  const task = tb?.task ? getTask(tb.task) : undefined;
  const base: Record<string, VariantValue> = {};
  if (task) for (const [k, v] of Object.entries(task.setup.variant)) if (v !== undefined) base[k] = v;
  return { ...base, ...(tb?.variant ?? {}), ...overrides };
}

/** True when the spec asks for testbed setup (seed, task, login or variant). */
export function usesTestbed(spec: QaSpec, overrides: Record<string, VariantValue> = {}): boolean {
  const fm = spec.frontMatter;
  return (
    fm.testbed !== undefined ||
    fm.seed !== undefined ||
    fm.login !== undefined ||
    Object.keys(overrides).length > 0
  );
}

export function createWebCaseExecutor(rt: EngineRuntime, opts: WebCaseExecutorOptions): CaseExecutor {
  const fm = opts.spec.frontMatter;
  const control = createControlClient({ baseUrl: opts.controlOrigin ?? CONTROL_ORIGIN });
  const testbed = usesTestbed(opts.spec, opts.variant);
  const known = new Set(listTaskIds());
  const oracle = async (taskId: string): Promise<boolean | undefined> => {
    if (!testbed || !known.has(taskId)) return undefined;
    const r = await control.oracle(taskId);
    return r.ok ? r.value.pass : undefined;
  };

  async function setup(): Promise<Result<BrowserCookie[], ExecuteError>> {
    if (!testbed) return ok([]);
    const tb = fm.testbed;
    const task = tb?.task ? getTask(tb.task) : undefined;
    if (tb?.task && !task) return err({ kind: "setup", message: `unknown testbed task "${tb.task}"` });
    const variant = VariantOverrides.strict().safeParse(effectiveVariant(opts.spec, opts.variant));
    if (!variant.success)
      return err({
        kind: "setup",
        message: `invalid testbed variant: ${variant.error.issues.map((i) => i.message).join("; ")}`,
      });
    const seed = fm.seed ?? tb?.seed ?? task?.setup.seed;
    const reset = await control.reset({ ...(seed !== undefined ? { seed } : {}), variant: variant.data });
    if (!reset.ok)
      return err({
        kind: "setup",
        message: `testbed reset failed (${reset.error.kind}): ${reset.error.message}. Is \`bun run dev:testbed\` running?`,
      });
    for (const name of [...(task?.setup.seeds ?? []), ...(tb?.seeds ?? [])]) {
      const seeded = await control.seed(name);
      if (!seeded.ok) return err({ kind: "setup", message: `seed ${name}: ${seeded.error.message}` });
    }
    const login = fm.login ?? task?.setup.login;
    if (!login) return ok([]);
    const session = await control.createSession(login);
    if (!session.ok) return err({ kind: "setup", message: `sign-in as ${login}: ${session.error.message}` });
    const appOrigin = opts.appOrigin ?? new URL(fm.url).origin;
    return ok([
      {
        name: session.value.cookie.name,
        value: session.value.cookie.value,
        url: appOrigin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }

  return {
    async execute(input: ExecuteCaseInput): Promise<Result<CaseExecution, ExecuteError>> {
      const cookies = await setup();
      if (!cookies.ok) return cookies;
      if (testbed)
        for (const name of input.task.secrets)
          if (isFixtureSecretName(name)) rt.secrets.register(name, fixtureSecrets[name]);
      const launched = await launchWeb(rt, {
        startUrl: input.task.startUrl,
        allowOrigins: input.task.allowOrigins,
        ...(opts.profile ? { profile: opts.profile } : {}),
        ...(opts.headless !== undefined ? { headless: opts.headless } : {}),
        cookies: cookies.value,
      });
      if (!launched.ok) return err({ kind: "launch", message: launched.error.message });
      const web = launched.value.computer;
      const probe = new QaProbeComputer(web, { audit: opts.a11y ?? true });
      const decision = new RecordingDecisionProvider(input.decision);
      const events: RunEvent[] = [];
      const checkpoints: Record<string, Checkpoint> = {};
      let lastShotFile: string | undefined;
      let lastStateFile: string | undefined;
      const onEvent = (e: RunEvent) => {
        events.push(e);
        if (e.type === "subgoal.start") {
          decision.subgoalId = e.subgoalId;
          lastStateFile = undefined;
        }
        if (e.type === "observe" && e.screenshot) lastShotFile = e.screenshot;
        if (e.type === "decision.request" && e.stateFile) lastStateFile = e.stateFile;
        if (e.type === "subgoal.end") {
          const snap = probe.latestSnapshot;
          checkpoints[e.subgoalId] = {
            ...(snap ? { snapshot: snap } : {}),
            ...(probe.latestScreenshot ? { screenshot: probe.latestScreenshot } : {}),
            ...(lastShotFile ? { screenshotFile: lastShotFile } : {}),
            ...(lastStateFile ? { stateFile: lastStateFile } : {}),
            ...(snap?.url ? { url: snap.url } : {}),
          };
        }
      };
      let report: Awaited<ReturnType<typeof runAgent>>;
      try {
        report = await runAgent(rt, {
          task: input.task,
          decision,
          trace: opts.trace ?? true,
          launch: async () => ({
            ok: true,
            value: { computer: probe, surface: launched.value.surface, close: async () => {} },
          }),
          hooks: { oracle, onEvent, ...(input.signal ? { signal: input.signal } : {}) },
        });
      } catch (e) {
        await web.close();
        return err({ kind: "engine", message: e instanceof Error ? e.message : String(e) });
      }
      if (!report.ok) {
        await web.close();
        return err({ kind: "engine", message: report.error });
      }
      const folder = report.value.folder;

      // Final observation, after the loop has returned.
      let final: Checkpoint | undefined;
      await web.waitIdle({ capMs: 3000 });
      const observed = await probe.observe();
      const shot = await web.screenshot();
      if (observed.ok) {
        const file = shot.ok ? writeShot(folder, "final.png", shot.value.data) : undefined;
        final = {
          snapshot: observed.value,
          ...(shot.ok ? { screenshot: shot.value.data } : {}),
          ...(file ? { screenshotFile: file } : {}),
          ...(observed.value.url ? { url: observed.value.url } : {}),
        };
      }
      const cps = Object.values(checkpoints);
      const thumbs = await makeThumbnails(web.page.context(), [
        ...cps.map((c) => c.screenshot ?? new Uint8Array()),
        final?.screenshot ?? new Uint8Array(),
      ]);
      cps.forEach((c, i) => {
        const t = thumbs[i];
        if (t) c.thumbnail = t;
      });
      const ft = thumbs[cps.length];
      if (final && ft) final.thumbnail = ft;
      const errors = { consoleErrors: [...web.consoleErrors], httpErrors: [...web.httpErrors] };
      const cookieHeader = (await web.page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
      await web.close();

      const result = report.value.result;
      return ok({
        runId: report.value.runId,
        folder,
        outcome: report.value.outcome,
        reason: report.value.reason,
        events,
        checkpoints,
        ...(final ? { final } : {}),
        errors,
        a11y: probe.a11y,
        holds: decision.holds,
        wallMs: result.wallMs,
        steps: result.steps,
        costUsd: "costUsd" in result ? result.costUsd : decision.costUsd,
        decisionCalls: result.decisionCalls,
        modelCalls: "modelCalls" in result ? result.modelCalls : 0,
        inputTokens: decision.inputTokens,
        checks: {
          oracle,
          http: (p) => httpCheck(p, fm.url, cookieHeader, new URL(fm.url).origin),
        },
        writeEvidence: (name, data) => {
          try {
            writeFileSync(join(folder, name), `${rt.secrets.redact(JSON.stringify(data, null, 2))}\n`);
            return name;
          } catch {
            return undefined;
          }
        },
      });
    },
  };
}

function writeShot(folder: string, name: string, data: Uint8Array): string | undefined {
  try {
    writeFileSync(join(folder, "screenshots", name), data);
    return `screenshots/${name}`;
  } catch {
    try {
      writeFileSync(join(folder, name), data);
      return name;
    } catch {
      return undefined;
    }
  }
}

/** HTTP checks run from the engine with the run's cookies, only against the spec's own origin. */
export async function httpCheck(
  p: Extract<Predicate, { kind: "http" }>,
  baseUrl: string,
  cookie: string,
  allowedOrigin: string,
  doFetch: typeof fetch = fetch,
): Promise<boolean | undefined> {
  let url: URL;
  try {
    url = new URL(p.url, baseUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== allowedOrigin) return undefined;
  try {
    const res = await doFetch(url, { method: p.method, headers: cookie ? { cookie } : {} });
    if (p.status !== undefined && res.status !== p.status) return false;
    if (p.path === undefined) return p.status !== undefined ? true : res.ok;
    const body: unknown = await res.json();
    let cur: unknown = body;
    for (const key of p.path.split(".")) {
      if (cur === null || typeof cur !== "object") return false;
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur === p.equals;
  } catch {
    return undefined;
  }
}
