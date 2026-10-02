// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The engine host's command handlers. It runs inside the Electron utilityProcess with @ghosthand/engine:
// one active run at a time, run history from the SQLite index, testbed tasks, doctor, models and
// profiles. Run events, approvals, status and screencast frames go to the renderer over the port.
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { HeuristicDecisionProvider } from "@ghosthand/core";
import { importChromeProfile, openProfileStore } from "@ghosthand/driver-playwright";
import {
  agentSecretNames,
  createAssistants,
  createDecisionProvider,
  type EngineRuntime,
  envValue,
  openRuntime,
  prepareTestbedRun,
  runAgent,
  runDoctor,
  webLauncher,
} from "@ghosthand/engine";
import { createModelCatalog, parseRoleBindings } from "@ghosthand/models";
import {
  type ActiveRun,
  type DecisionProvider,
  type EngineMessage,
  type HostCredentials,
  type HostNotice,
  type HostRequest,
  type HostResponse,
  IpcCommands,
  type IpcError,
  type RunStatus,
  type ScreencastFrame,
  type Settings,
  StartRunInput,
  TaskSpec,
} from "@ghosthand/protocol";
import { readRun, screenshotName } from "@ghosthand/recorder";
import { tasks } from "@ghosthand/testbed-kit";
import { FrameThrottle } from "./frame-throttle.ts";
import {
  defaultChromeUserDataDir,
  toModelListItem,
  toProfileItem,
  toRunListItem,
  toTaskListItem,
} from "./host-views.ts";
import { RunController } from "./run-controller.ts";
import {
  createIpcErrorFromProfile,
  isScreencastCapable,
  type ScreencastCapable,
} from "./screencast-capable.ts";

export interface PortLike {
  postMessage(message: unknown): void;
  close?(): void;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: IpcError };

const fail = (kind: IpcError["kind"], message: string): Outcome => ({ ok: false, error: { kind, message } });
const done = (value: unknown): Outcome => ({ ok: true, value });

/** Keys main may hand over that configure providers rather than being typed by the agent. */
const PROVIDER_KEYS = new Set(["TYPESAFE_API_KEY", "OPENAI_API_KEY"]);

interface ActiveRunState {
  info: ActiveRun;
  controller: RunController;
  computer: ScreencastCapable | undefined;
  throttle: FrameThrottle<ScreencastFrame>;
  finished: Promise<void>;
}

export class HostService {
  readonly #notify: (notice: HostNotice) => void;
  readonly #version: string;
  #port: PortLike | undefined;
  #active: ActiveRunState | undefined;
  #queryRuntime: Promise<EngineRuntime | undefined> | undefined;

  constructor(opts: { notify: (notice: HostNotice) => void; version: string }) {
    this.#notify = opts.notify;
    this.#version = opts.version;
  }

  setPort(port: PortLike): void {
    this.#port?.close?.();
    this.#port = port;
    this.#send({ kind: "hello", version: this.#version });
    const a = this.#active;
    if (a) this.#send({ kind: "status", runId: a.info.runId, status: a.info.status });
  }

  #send(message: EngineMessage): void {
    try {
      this.#port?.postMessage(message);
    } catch {
      // The renderer went away; a reload brings a new port.
    }
  }

  async #runtime(): Promise<EngineRuntime | undefined> {
    this.#queryRuntime ??= openRuntime({ logLevel: "warn" }).then((r) => (r.ok ? r.value : undefined));
    return this.#queryRuntime;
  }

  async handle(req: HostRequest): Promise<HostResponse> {
    let outcome: Outcome;
    try {
      outcome = await this.#dispatch(req);
    } catch (e) {
      outcome = fail("engine", e instanceof Error ? (e.message.split("\n")[0] ?? "error") : String(e));
    }
    return outcome.ok
      ? { kind: "response", id: req.id, ok: true, value: outcome.value }
      : { kind: "response", id: req.id, ok: false, error: outcome.error };
  }

  async #dispatch(req: HostRequest): Promise<Outcome> {
    const input = req.input;
    switch (req.command) {
      case "app.runsDir": {
        const rt = await this.#runtime();
        return done(rt?.runsDir ?? "");
      }
      case "tasks.list":
        return done(tasks.map(toTaskListItem));
      case "runs.list": {
        const p = IpcCommands["runs.list"].input.parse(input);
        const rt = await this.#runtime();
        if (!rt) return fail("unavailable", "run index unavailable");
        const r = rt.index.listRuns({ limit: p.limit ?? 100, ...(p.taskId ? { taskId: p.taskId } : {}) });
        return r.ok ? done(r.value.map(toRunListItem)) : fail("engine", r.error.message);
      }
      case "runs.get": {
        const { runId } = IpcCommands["runs.get"].input.parse(input);
        const rt = await this.#runtime();
        const r = rt?.index.getRun(runId);
        if (!r) return fail("unavailable", "run index unavailable");
        return r.ok ? done(toRunListItem(r.value)) : fail("not_found", r.error.message);
      }
      case "runs.events":
        return this.#events(IpcCommands["runs.events"].input.parse(input).runId);
      case "runs.screenshot": {
        const p = IpcCommands["runs.screenshot"].input.parse(input);
        return this.#screenshot(p.runId, p.step);
      }
      case "runs.start":
        return this.#start(input, req.settings, req.credentials);
      case "runs.stop":
        return this.#withRun(input, (a) => {
          a.controller.stop();
          return done(null);
        });
      case "runs.approve": {
        const p = IpcCommands["runs.approve"].input.parse(input);
        const a = this.#active;
        if (!a?.controller.respond(p.requestId, p.decision)) {
          return fail("not_found", "no pending approval with that id");
        }
        return done(null);
      }
      case "runs.takeover":
        return this.#withRun(input, (a) => {
          a.controller.pause();
          void a.computer?.page.bringToFront().catch(() => {});
          return done(null);
        });
      case "runs.resume":
        return this.#withRun(input, (a) => {
          a.controller.resume();
          return done(null);
        });
      case "runs.toggleTakeover": {
        const a = this.#active;
        if (!a || a.info.status === "ended") return done(null);
        if (!a.controller.paused) void a.computer?.page.bringToFront().catch(() => {});
        a.controller.toggle();
        return done(null);
      }
      case "runs.active":
        return done(this.#active?.info ?? null);
      case "doctor.run":
        return this.#doctor(req.credentials);
      case "models.list":
        return this.#models(req.credentials);
      case "profiles.list": {
        const r = await openProfileStore().list();
        return r.ok ? done(r.value.map(toProfileItem)) : fail("engine", r.error.message);
      }
      case "profiles.create": {
        const { name } = IpcCommands["profiles.create"].input.parse(input);
        const r = await openProfileStore().create(name);
        return r.ok ? done(toProfileItem(r.value)) : createIpcErrorFromProfile(r.error);
      }
      case "profiles.import": {
        const p = IpcCommands["profiles.import"].input.parse(input);
        const source = join(
          defaultChromeUserDataDir(process.platform, process.env, homedir()),
          p.chromeProfile,
        );
        const r = await importChromeProfile(source, p.name);
        return r.ok
          ? done(toProfileItem({ ...r.value, sizeBytes: r.value.bytes }))
          : createIpcErrorFromProfile(r.error);
      }
    }
  }

  #withRun(input: unknown, fn: (a: ActiveRunState) => Outcome): Outcome {
    const parsed = IpcCommands["runs.stop"].input.safeParse(input);
    const a = this.#active;
    if (!parsed.success || !a || a.info.runId !== parsed.data.runId)
      return fail("not_found", "no such active run");
    return fn(a);
  }

  async #events(runId: string): Promise<Outcome> {
    const rt = await this.#runtime();
    const rec = rt?.index.getRun(runId);
    if (!rec?.ok) return fail("not_found", `run ${runId} is not in the index`);
    const log = readRun(rec.value.folder);
    if (!log.ok) return fail(log.error.kind === "not_found" ? "not_found" : "engine", log.error.message);
    let screenshotSteps: number[] = [];
    try {
      screenshotSteps = readdirSync(join(rec.value.folder, "screenshots"))
        .map((f) => /^step-(\d+)\.png$/.exec(f)?.[1])
        .filter((s): s is string => s !== undefined)
        .map(Number)
        .sort((a, b) => a - b);
    } catch {
      // No screenshots folder.
    }
    return done({ runId, events: log.value.events, screenshotSteps });
  }

  async #screenshot(runId: string, step: number): Promise<Outcome> {
    const rt = await this.#runtime();
    const rec = rt?.index.getRun(runId);
    if (!rec?.ok) return fail("not_found", `run ${runId} is not in the index`);
    try {
      const bytes = await readFile(join(rec.value.folder, "screenshots", screenshotName(step)));
      return done({ dataUrl: `data:image/png;base64,${bytes.toString("base64")}` });
    } catch {
      return done(null);
    }
  }

  async #openRunRuntime(settings: Settings, input: StartRunInput, credentials: HostCredentials | undefined) {
    const opened = await openRuntime({
      logLevel: "warn",
      overrides: {
        budget: settings.budget,
        browser: {
          profile: input.profile ?? settings.defaultProfile,
          headless: !(input.showBrowser ?? settings.showBrowser),
        },
      },
    });
    if (!opened.ok) return opened;
    const rt = opened.value;
    for (const [name, value] of Object.entries(credentials?.secrets ?? {})) {
      rt.envFile.values.set(name, value);
      if (!PROVIDER_KEYS.has(name)) rt.secrets.register(name, value);
    }
    return opened;
  }

  #decision(
    rt: EngineRuntime,
    input: StartRunInput,
    settings: Settings,
    capUsd: number,
  ): { ok: true; value: DecisionProvider; label: string } | { ok: false; error: IpcError } {
    if (input.decision === "heuristic") {
      if (!settings.devPlumbingMode)
        return { ok: false, error: { kind: "invalid_input", message: "plumbing mode is off" } };
      return { ok: true, value: new HeuristicDecisionProvider(), label: "heuristic (plumbing mode)" };
    }
    if (!envValue("TYPESAFE_API_KEY", rt.envFile) && settings.devPlumbingMode) {
      return {
        ok: true,
        value: new HeuristicDecisionProvider(),
        label: "heuristic (plumbing mode: no TypeSafe key)",
      };
    }
    const d = createDecisionProvider(rt, capUsd);
    if (!d.ok) {
      return {
        ok: false,
        error: {
          kind: "unavailable",
          message: "No TypeSafe key. Add TYPESAFE_API_KEY in Settings → Providers.",
        },
      };
    }
    return { ok: true, value: d.value, label: d.value.id };
  }

  async #start(
    rawInput: unknown,
    settings: Settings | undefined,
    credentials: HostCredentials | undefined,
  ): Promise<Outcome> {
    if (this.#active && this.#active.info.status !== "ended") return fail("busy", "a run is already active");
    const input = StartRunInput.parse(rawInput);
    if (!settings) return fail("internal", "settings missing");
    const opened = await this.#openRunRuntime(settings, input, credentials);
    if (!opened.ok) return fail("engine", opened.error.message);
    const rt = opened.value;

    let task: TaskSpec;
    let oracle: ((id: string) => Promise<boolean | undefined>) | undefined;
    let cookies: Parameters<typeof webLauncher>[1]["cookies"] = [];
    if (input.source.kind === "testbed") {
      const prepared = await prepareTestbedRun(input.source.taskId);
      if (!prepared.ok) {
        rt.index.close();
        return fail(
          prepared.error.kind === "unknown_task" ? "not_found" : "unavailable",
          prepared.error.message,
        );
      }
      for (const [name, value] of Object.entries(prepared.value.secrets)) rt.secrets.register(name, value);
      task = prepared.value.spec;
      oracle = prepared.value.oracle;
      cookies = prepared.value.cookies;
    } else {
      task = TaskSpec.parse({
        id: "adhoc",
        instruction: input.source.goal,
        startUrl: input.source.startUrl,
        allowOrigins: input.source.allowOrigins,
        secrets: agentSecretNames(rt),
        budget: settings.budget,
      });
    }

    const decision = this.#decision(rt, input, settings, task.budget.usd);
    if (!decision.ok) {
      rt.index.close();
      return { ok: false, error: decision.error };
    }
    const bindings = parseRoleBindings(settings.roleBindings);
    const assistants = await createAssistants(
      rt,
      { planner: input.planner ?? settings.planner, writer: input.writer ?? settings.writer },
      {
        ...(credentials?.chatgptAccessToken ? { chatgptAccessToken: credentials.chatgptAccessToken } : {}),
        ...(bindings.ok && Object.keys(bindings.value).length > 0 ? { bindings: bindings.value } : {}),
      },
    );

    let runId = "";
    let resolveStarted!: (id: string | undefined) => void;
    const started = new Promise<string | undefined>((r) => {
      resolveStarted = r;
    });
    const setStatus = (status: RunStatus, detail?: string) => {
      if (!state) return;
      state.info = { ...state.info, status };
      if (runId) {
        this.#send({ kind: "status", runId, status, ...(detail ? { detail } : {}) });
        this.#notify({ kind: "run.status", runId, status });
      }
    };
    const controller = new RunController({
      status: setStatus,
      approvalRequested: (request) => this.#send({ kind: "approval.request", runId, request }),
      approvalResolved: (requestId, d) =>
        this.#send({ kind: "approval.resolved", runId, requestId, decision: d }),
    });
    const throttle = new FrameThrottle<ScreencastFrame>((frame) =>
      this.#send({ kind: "frame", runId, frame }),
    );
    const state: ActiveRunState = {
      info: {
        runId: "",
        status: "starting",
        task: { id: task.id, instruction: task.instruction, startUrl: task.startUrl },
        decision: decision.label,
        startedAt: Date.now(),
      },
      controller,
      computer: undefined,
      throttle,
      finished: Promise.resolve(),
    };
    this.#active = state;

    const baseLaunch = webLauncher(rt, {
      startUrl: task.startUrl,
      allowOrigins: task.allowOrigins,
      ...(input.profile ? { profile: input.profile } : {}),
      headless: !(input.showBrowser ?? settings.showBrowser),
      cookies,
    });

    state.finished = runAgent(rt, {
      autonomy: input.unattended ? "unattended" : "supervised",
      ...(assistants.planner ? { planner: assistants.planner } : {}),
      ...(assistants.writer ? { writer: assistants.writer } : {}),
      task,
      decision: decision.value,
      launch: async () => {
        const launched = await baseLaunch();
        if (launched.ok && isScreencastCapable(launched.value.computer))
          state.computer = launched.value.computer;
        return launched;
      },
      hooks: {
        ...(oracle ? { oracle } : {}),
        approve: controller.approve,
        signal: controller.abort.signal,
        control: controller,
        onEvent: (event) => {
          if (!runId) {
            runId = event.runId;
            state.info = { ...state.info, runId, status: "running" };
            this.#notify({ kind: "run.status", runId, status: "running" });
            this.#send({ kind: "status", runId, status: "running", detail: decision.label });
            resolveStarted(runId);
            void state.computer?.startScreencast((frame) => throttle.push(frame));
          }
          this.#send({ kind: "run.event", runId, event });
        },
      },
    })
      .then((report) => {
        if (!report.ok) {
          resolveStarted(undefined);
          return;
        }
        throttle.dispose();
        state.info = { ...state.info, status: "ended" };
        this.#send({
          kind: "status",
          runId: report.value.runId,
          status: "ended",
          detail: report.value.reason,
          outcome: report.value.outcome,
          ...(report.value.oraclePass !== undefined ? { oraclePass: report.value.oraclePass } : {}),
        });
        this.#notify({ kind: "run.status", runId: report.value.runId, status: "ended" });
      })
      .catch((e: unknown) => {
        resolveStarted(undefined);
        state.info = { ...state.info, status: "ended" };
        if (runId) {
          this.#send({
            kind: "status",
            runId,
            status: "ended",
            detail: e instanceof Error ? e.message : String(e),
          });
          this.#notify({ kind: "run.status", runId, status: "ended" });
        }
      })
      .finally(async () => {
        throttle.dispose();
        await assistants.close().catch(() => {});
        rt.index.close();
        // The shared query runtime caches nothing per run, so history refreshes on the next list.
      });

    const id = await started;
    if (!id) {
      this.#active = undefined;
      return fail("engine", "the run could not start (see the engine log)");
    }
    return done({ runId: id });
  }

  async #doctor(credentials: HostCredentials | undefined): Promise<Outcome> {
    const opened = await openRuntime({ logLevel: "warn" });
    if (!opened.ok) return fail("engine", opened.error.message);
    const rt = opened.value;
    for (const [name, value] of Object.entries(credentials?.secrets ?? {}))
      rt.envFile.values.set(name, value);
    try {
      const checks = await runDoctor(rt, {});
      return done(checks);
    } finally {
      rt.index.close();
    }
  }

  async #models(credentials: HostCredentials | undefined): Promise<Outcome> {
    const catalog = createModelCatalog();
    if (!catalog.ok) return fail("engine", catalog.error.message);
    const rt = await this.#runtime();
    const secrets = credentials?.secrets ?? {};
    const hasOpenAI =
      Boolean(credentials?.chatgptAccessToken) ||
      Boolean(secrets.OPENAI_API_KEY) ||
      Boolean(rt && envValue("OPENAI_API_KEY", rt.envFile));
    const items = catalog.value
      .list()
      .filter((m) => m.outputModalities.includes("text"))
      .map((m) =>
        toModelListItem(m, m.provider === "openai" ? (hasOpenAI ? "set" : "missing") : "unsupported"),
      )
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.ref.localeCompare(b.ref));
    return done(items);
  }
}
