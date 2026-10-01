// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Voice-guided mode (Phase 4): one run folder per voice session. Each spoken command is recorded as a
// `model.call` (role "speech") plus a `human` input event, resolved by @ghosthand/voice, and executed as
// one recorded action (mode H) on the running Computer, or handed to the core loop as a goal.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCandidates,
  type EventSink,
  execute,
  type Planner,
  type RunResult,
  runTask,
  type Writer,
} from "@ghosthand/core";
import type {
  Action,
  ActionResult,
  Computer,
  DecisionProvider,
  Element,
  RunEventDraft,
  Snapshot,
  TaskSpec,
  VoiceCommand,
} from "@ghosthand/protocol";
import { TaskSpec as TaskSpecSchema } from "@ghosthand/protocol";
import type { RunSummary } from "@ghosthand/recorder";
import {
  describeCommand,
  encodeWav,
  FocusStack,
  type ParseResult,
  parseUtterance,
  type ResolveContext,
  resolveCommand,
  resolveUtterance,
  type SttResult,
  type VoiceDecisionTrace,
  type VoiceResolution,
} from "@ghosthand/voice";
import {
  type ComputerLauncher,
  closeSession,
  type LaunchedComputer,
  openSession,
  type RunHooks,
  type RunSession,
} from "./run-agent.ts";
import { type EngineRuntime, gitSha } from "./runtime.ts";

/** Max number badges shown at once (Voice Access style). */
export const MAX_BADGES = 99;

export interface VoiceConfirmRequest {
  command: VoiceCommand;
  action: Action;
  element?: Element;
  effect: "commit" | "forbidden";
  /** Forbidden effects also need a key press or click; voice alone is not enough. */
  manual: boolean;
  summary: string;
}

export interface VoiceSessionOptions {
  launch: ComputerLauncher;
  /** Jev; without it only grammar commands with code-resolvable targets run. */
  decision?: DecisionProvider;
  /** Multi-step utterances run as goals through the core loop (needs `decision`). */
  planner?: Planner;
  writer?: Writer;
  /** Opened once at session start. */
  startUrl?: string;
  /** Opt-in: write each utterance's audio to `audio/utt-NNN.wav` in the run folder. */
  recordAudio?: boolean;
  /**
   * Shows the confirm card for commit/forbidden effects and resolves with the user's answer.
   * Without it, risky commands stay pending until a later "confirm"/"deny" command.
   */
  confirm?: (req: VoiceConfirmRequest) => Promise<boolean>;
  hooks?: RunHooks;
}

interface HistoryEntry {
  command: VoiceCommand;
  action?: Action;
  element?: Element;
  urlBefore?: string;
  urlAfter?: string;
}

export interface VoiceSession {
  readonly runId: string;
  readonly folder: string;
  readonly computer: Computer;
  readonly focus: FocusStack;
  /** Aborts the in-flight action or goal run ("stop"). Safe to call from a stop-word callback. */
  abort(reason?: string): void;
  /** Ends the session: writes run.end and summary.json, closes the browser. */
  close(): Promise<RunSummary | undefined>;
  /** Internal state, exposed for the engine and tests. */
  readonly state: VoiceSessionState;
}

export interface VoiceSessionState {
  step: number;
  started: number;
  decisionCalls: number;
  modelCalls: number;
  costUsd: number;
  history: HistoryEntry[];
  pending: { command: VoiceCommand; resolution: Extract<VoiceResolution, { kind: "action" }> } | undefined;
  controller: AbortController;
  recording: RunSession;
  launched: LaunchedComputer;
  opts: VoiceSessionOptions;
  closed: boolean;
}

export type VoiceOutcome =
  | "executed"
  | "needs_confirmation"
  | "declined"
  | "clarify"
  | "goal_done"
  | "goal_failed"
  | "control"
  | "unresolved"
  | "unsupported"
  | "aborted"
  | "error";

export interface VoiceBadge {
  n: number;
  token: string;
  role: string;
  name: string;
}

export interface VoiceCommandReport {
  step: number;
  outcome: VoiceOutcome;
  detail: string;
  transcript?: string;
  parse?: ParseResult;
  command?: VoiceCommand;
  resolution?: VoiceResolution;
  result?: ActionResult;
  /** Badges to draw (after "show numbers" or a clarification). */
  badges?: VoiceBadge[];
  goal?: RunResult;
  wallMs: number;
}

/** A spoken utterance, optionally with its STT result and audio. */
export interface VoiceTranscript {
  text: string;
  stt?: SttResult;
  /** 16 kHz mono samples; written only when the session opted in to audio recording. */
  audio?: Float32Array;
  /** USD per audio minute of the backend, for the cost line. */
  usdPerMinute?: number;
}

export const VOICE_HELP = [
  "click/open/select <name | number | the second X | this | that one>",
  "type <text> [into <field>] · fill <field> with <value> · clear · submit · press enter/tab/escape",
  "scroll up/down [N times] · scroll to top/bottom · page up/down",
  "go back · reload · go to <site> · next/previous page",
  "show numbers · hide numbers · stop · cancel · undo · repeat · no, the other one · yes/no",
].join("\n");

const voiceTask = (startUrl: string | undefined): TaskSpec =>
  TaskSpecSchema.parse({
    id: "voice",
    mode: "do",
    instruction: "Voice-guided session",
    startUrl: startUrl ?? "about:blank",
  });

export async function openVoiceSession(
  rt: EngineRuntime,
  opts: VoiceSessionOptions,
): Promise<{ ok: true; value: VoiceSession } | { ok: false; error: string }> {
  const hooks = opts.hooks ?? {};
  const opened = openSession(rt, hooks);
  if (!opened.ok) return opened;
  const recording = opened.value;
  const launched = await opts.launch();
  const sha = gitSha();
  recording.sink.emit({
    type: "run.start",
    task: voiceTask(opts.startUrl),
    ...(sha ? { gitSha: sha } : {}),
    decisionModel: opts.decision?.id ?? "none",
    surface: launched.ok ? `${launched.value.surface} / voice` : "none",
  });
  if (!launched.ok) {
    emitEnd(recording.sink, "error", `launch failed: ${launched.error.message}`, 0, 0, 0, 0, 0);
    await closeSession(recording, undefined);
    return { ok: false, error: launched.error.message };
  }
  const computer = launched.value.computer;
  await computer.startRecording(recording.recorder.paths.folder);
  if (opts.startUrl) {
    const r = await computer.open(opts.startUrl);
    if (!r.ok) {
      emitEnd(recording.sink, "error", `open failed: ${r.error.message}`, 0, 0, 0, 0, 0);
      await closeSession(recording, launched.value);
      return { ok: false, error: r.error.message };
    }
  }
  const state: VoiceSessionState = {
    step: 0,
    started: Date.now(),
    decisionCalls: 0,
    modelCalls: 0,
    costUsd: 0,
    history: [],
    pending: undefined,
    controller: new AbortController(),
    recording,
    launched: launched.value,
    opts,
    closed: false,
  };
  const session: VoiceSession = {
    runId: recording.recorder.runId,
    folder: recording.recorder.paths.folder,
    computer,
    focus: new FocusStack(),
    state,
    abort(reason = "stop") {
      state.controller.abort(new Error(reason));
    },
    async close() {
      if (state.closed) return undefined;
      state.closed = true;
      state.controller.abort(new Error("session closed"));
      const executed = state.history.filter((h) => h.action).length;
      emitEnd(
        recording.sink,
        "success",
        `voice session: ${state.history.length} commands, ${executed} actions`,
        state.step,
        Date.now() - state.started,
        state.costUsd,
        state.decisionCalls,
        state.modelCalls,
        executed > 0 ? { H: 1 } : {},
      );
      return closeSession(recording, launched.value);
    },
  };
  return { ok: true, value: session };
}

function emitEnd(
  sink: EventSink,
  outcome: "success" | "error",
  reason: string,
  steps: number,
  wallMs: number,
  costUsd: number,
  decisionCalls: number,
  modelCalls: number,
  modeShares: Record<string, number> = {},
): void {
  sink.emit({
    type: "run.end",
    outcome,
    reason,
    steps,
    wallMs,
    costUsd,
    decisionCalls,
    modelCalls,
    modeShares,
  });
}

// ---------------------------------------------------------------------------------------------------------
// One command

const fingerprint = (el: Element) => ({
  stableId: el.stableId,
  role: el.role,
  name: el.name,
  ...(el.automationId ? { automationId: el.automationId } : {}),
});

const refused = (message: string, kind: "unsupported" | "timeout" = "unsupported"): ActionResult => ({
  effect: "refused",
  route: "none",
  evidence: [],
  error: { kind, message },
  invalidatedSnapshots: [],
  durationMs: 0,
});

interface NavigableComputer extends Computer {
  back?(): Promise<ActionResult>;
}

/** Runs one action; navigate/back go through open()/back(), everything else through core `execute`. */
async function perform(computer: NavigableComputer, action: Action): Promise<ActionResult> {
  if (action.type === "navigate") {
    const started = performance.now();
    const r = await computer.open(action.url);
    return r.ok
      ? {
          effect: "unverifiable",
          route: "navigation",
          evidence: [{ kind: "url", after: action.url }],
          invalidatedSnapshots: [],
          durationMs: performance.now() - started,
        }
      : { ...refused(r.error.message), error: { kind: "driver", message: r.error.message } };
  }
  if (action.type === "back") {
    return typeof computer.back === "function" ? computer.back() : refused("this computer cannot go back");
  }
  return execute(computer, action);
}

/** Resolves with the action result, or with an aborted result as soon as the signal fires. */
function abortable(p: Promise<ActionResult>, signal: AbortSignal): Promise<ActionResult | "aborted"> {
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    const onAbort = () => resolve("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (r) => {
        signal.removeEventListener("abort", onAbort);
        resolve(r);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        resolve(refused(e instanceof Error ? e.message : String(e)));
      },
    );
  });
}

function recordDecision(session: VoiceSession, step: number, trace: VoiceDecisionTrace | undefined): void {
  if (!trace) return;
  const s = session.state;
  const sink = s.recording.sink;
  s.decisionCalls++;
  sink.emit({ type: "decision.request", step, purpose: "act", questions: trace.questions, stateTokens: 0 });
  const r = trace.response;
  if (r) s.costUsd += r.costUsd;
  sink.emit({
    type: "decision.answer",
    step,
    ...(r ? { answers: r.answers } : {}),
    ...(trace.error ? { error: trace.error } : {}),
    model: r?.model ?? session.state.opts.decision?.id ?? "decision",
    ...(r?.requestId ? { requestId: r.requestId } : {}),
    latencyMs: r?.latencyMs ?? 0,
    costUsd: r?.costUsd ?? 0,
    inputTokens: r?.usage.inputTokens ?? 0,
  });
}

function recordTranscript(session: VoiceSession, step: number, t: VoiceTranscript): void {
  const s = session.state;
  if (t.stt) {
    const cost = t.usdPerMinute ? (t.stt.audioMs / 60_000) * t.usdPerMinute : 0;
    s.modelCalls++;
    s.costUsd += cost;
    s.recording.sink.emit({
      type: "model.call",
      step,
      role: "speech",
      model: `${t.stt.backend}:${t.stt.model}`,
      latencyMs: Math.round(t.stt.latencyMs),
      ...(cost > 0 ? { costUsd: cost } : {}),
      ok: true,
      summary: `${Math.round(t.stt.audioMs)} ms audio`,
    });
  }
  if (s.opts.recordAudio && t.audio && t.audio.length > 0) {
    const name = `utt-${String(step).padStart(3, "0")}.wav`;
    try {
      const dir = join(session.folder, "audio");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), encodeWav(t.audio), { mode: 0o600 });
    } catch {
      // Audio is optional; a failed write must not break the command.
    }
  }
}

/** Numbers up to 99 interactive elements in reading order and returns them for the overlay. */
function showBadges(session: VoiceSession, snapshot: Snapshot, els?: Element[]): VoiceBadge[] {
  let list = els;
  if (!list) {
    const c = buildCandidates(snapshot);
    const ids = new Set([...c.press, ...c.set_value, ...c.toggle, ...c.select_option].map((e) => e.stableId));
    list = snapshot.elements.filter((e) => ids.has(e.stableId));
  }
  const shown = session.focus.showBadges(list.slice(0, MAX_BADGES));
  return [...shown].map(([n, e]) => ({ n, token: e.token, role: e.role, name: e.name }));
}

const summaryOf = (r: Extract<VoiceResolution, { kind: "action" }>): string =>
  r.element ? `${r.command.verb} ${r.element.role} "${r.element.name}"` : describeCommand(r.command);

/**
 * Runs one voice command on the session: a transcript (parsed and resolved here) or an already parsed
 * command. Never throws for expected failures; the report says what happened.
 */
export async function runVoiceCommand(
  rt: EngineRuntime,
  session: VoiceSession,
  input: VoiceTranscript | VoiceCommand,
): Promise<VoiceCommandReport> {
  const s = session.state;
  const started = performance.now();
  const step = ++s.step;
  const report = (r: Omit<VoiceCommandReport, "step" | "wallMs">): VoiceCommandReport => {
    const full = { ...r, step, wallMs: performance.now() - started };
    s.recording.sink.emit({
      type: "step.end",
      step,
      timing: { settleMs: 0, observeMs: 0, decideMs: 0, actMs: 0, verifyMs: 0 },
      mode: "H",
    });
    return full;
  };
  if (s.closed) return report({ outcome: "error", detail: "session is closed" });

  // A new command starts with a fresh abort signal; "stop" aborts the previous one first.
  const isCommand = "verb" in input;
  const text = isCommand ? input.utterance : input.text;
  const quick = isCommand ? undefined : parseUtterance(text);
  const quickVerb = isCommand ? input.verb : quick?.kind === "command" ? quick.command.verb : undefined;
  if (quickVerb === "stop" || quickVerb === "cancel") session.abort(quickVerb);
  if (s.controller.signal.aborted) s.controller = new AbortController();
  const signal = s.controller.signal;

  if (!isCommand) recordTranscript(session, step, input);
  const observed = await session.computer.observe();
  if (!observed.ok) {
    s.recording.sink.emit({ type: "human", step, kind: "input", detail: `voice: ${JSON.stringify(text)}` });
    return report({
      outcome: "error",
      detail: `observe failed: ${observed.error.message}`,
      transcript: text,
    });
  }
  const snapshot = observed.value;
  const ctx: ResolveContext = {
    snapshot,
    focus: session.focus,
    ...(s.opts.decision ? { decision: s.opts.decision } : {}),
    signal,
  };
  const resolved = isCommand
    ? { parse: undefined, ...(await resolveCommand(input, ctx)) }
    : await resolveUtterance(input.text, ctx);
  const { resolution } = resolved;
  const command = resolution.command;
  s.recording.sink.emit({
    type: "human",
    step,
    kind: "input",
    detail: `voice: ${JSON.stringify(text)} → ${command ? describeCommand(command) : resolution.kind}`,
  });
  recordDecision(session, step, resolved.decision);
  const base = {
    transcript: text,
    ...(resolved.parse ? { parse: resolved.parse } : {}),
    ...(command ? { command } : {}),
    resolution,
  };

  switch (resolution.kind) {
    case "unresolved":
      return report({ ...base, outcome: "unresolved", detail: resolution.reason });
    case "clarify":
      return report({
        ...base,
        outcome: "clarify",
        detail: `which one? (${resolution.reason})`,
        badges: showBadges(session, snapshot, resolution.candidates),
      });
    case "goal":
      return report({ ...base, ...(await runGoal(rt, session, step, resolution.goal, snapshot, signal)) });
    case "control":
      return report({ ...base, ...(await control(session, resolution.command, snapshot, ctx)) });
    case "action":
      return report({ ...base, ...(await act(session, step, resolution, snapshot, signal)) });
  }
}

type Partial2 = Omit<
  VoiceCommandReport,
  "step" | "wallMs" | "transcript" | "parse" | "command" | "resolution"
>;

async function act(
  session: VoiceSession,
  step: number,
  r: Extract<VoiceResolution, { kind: "action" }>,
  snapshot: Snapshot,
  signal: AbortSignal,
): Promise<Partial2> {
  const s = session.state;
  if (r.needsConfirmation) {
    const effect = r.effect === "forbidden" ? "forbidden" : "commit";
    const req: VoiceConfirmRequest = {
      command: r.command,
      action: r.action,
      ...(r.element ? { element: r.element } : {}),
      effect,
      manual: effect === "forbidden",
      summary: summaryOf(r),
    };
    if (!s.opts.confirm) {
      s.pending = { command: r.command, resolution: r };
      return { outcome: "needs_confirmation", detail: `say "confirm" to ${req.summary}` };
    }
    const granted = await s.opts.confirm(req);
    s.recording.sink.emit({ type: "human", step, kind: "approval", detail: req.summary, granted });
    if (!granted) return { outcome: "declined", detail: `not confirmed: ${req.summary}` };
  }
  if (r.element) session.focus.highlight(r.element);
  s.recording.sink.emit({
    type: "action",
    step,
    action: r.action,
    ...(r.element ? { target: fingerprint(r.element) } : {}),
    mode: "H",
  });
  const result = await abortable(perform(session.computer, r.action), signal);
  if (result === "aborted") {
    const aborted = refused("aborted by voice", "timeout");
    s.recording.sink.emit({ type: "effect", step, result: aborted });
    return { outcome: "aborted", detail: "stopped", result: aborted };
  }
  s.recording.sink.emit({ type: "effect", step, result });
  if (r.element) session.focus.acted(r.element);
  const urlAfter = result.evidence.find((e) => e.kind === "url")?.after;
  s.history.push({
    command: r.command,
    action: r.action,
    ...(r.element ? { element: r.element } : {}),
    ...(snapshot.url ? { urlBefore: snapshot.url } : {}),
    ...(urlAfter ? { urlAfter } : {}),
  });
  const ok = result.effect !== "refused";
  return {
    outcome: ok ? "executed" : "error",
    detail: ok ? `${summaryOf(r)} (${result.effect})` : (result.error?.message ?? "refused"),
    result,
  };
}

async function control(
  session: VoiceSession,
  command: VoiceCommand,
  snapshot: Snapshot,
  ctx: ResolveContext,
): Promise<Partial2> {
  const s = session.state;
  const last = s.history[s.history.length - 1];
  switch (command.verb) {
    case "stop":
    case "cancel":
      s.pending = undefined;
      return { outcome: "control", detail: command.verb === "stop" ? "stopped" : "cancelled" };
    case "wait":
    case "continue":
      return { outcome: "control", detail: command.verb === "wait" ? "waiting" : "continuing" };
    case "help":
      return { outcome: "control", detail: VOICE_HELP };
    case "show_numbers":
      return { outcome: "control", detail: "numbers shown", badges: showBadges(session, snapshot) };
    case "hide_numbers":
      session.focus.hideBadges();
      return { outcome: "control", detail: "numbers hidden", badges: [] };
    case "confirm": {
      const p = s.pending;
      if (!p) return { outcome: "unresolved", detail: "nothing to confirm" };
      s.pending = undefined;
      s.recording.sink.emit({
        type: "human",
        step: s.step,
        kind: "approval",
        detail: summaryOf(p.resolution),
        granted: true,
      });
      return act(
        session,
        s.step,
        { ...p.resolution, needsConfirmation: false },
        snapshot,
        s.controller.signal,
      );
    }
    case "deny": {
      const p = s.pending;
      s.pending = undefined;
      if (p)
        s.recording.sink.emit({
          type: "human",
          step: s.step,
          kind: "approval",
          detail: summaryOf(p.resolution),
          granted: false,
        });
      return { outcome: p ? "declined" : "control", detail: p ? "cancelled" : "no" };
    }
    case "undo": {
      if (last?.urlAfter && last.urlAfter !== last.urlBefore) {
        const r = await act(
          session,
          s.step,
          {
            kind: "action",
            command,
            action: { type: "back" },
            effect: "advance",
            needsConfirmation: false,
            via: "none",
          },
          snapshot,
          s.controller.signal,
        );
        return { ...r, detail: `undo: ${r.detail}` };
      }
      return { outcome: "unsupported", detail: "the last action cannot be undone automatically" };
    }
    case "repeat": {
      if (!last) return { outcome: "unresolved", detail: "nothing to repeat" };
      const again = await resolveCommand(last.command, ctx);
      recordDecision(session, s.step, again.decision);
      if (again.resolution.kind !== "action") return { outcome: "unresolved", detail: "cannot repeat here" };
      return act(session, s.step, again.resolution, snapshot, s.controller.signal);
    }
    case "correct": {
      if (!last) return { outcome: "unresolved", detail: "nothing to correct" };
      // Undo first when the wrong target navigated away, then redo the verb on the new target.
      let current = snapshot;
      if (last.urlAfter && last.urlAfter !== last.urlBefore) {
        const back = await perform(session.computer, { type: "back" });
        s.recording.sink.emit({ type: "action", step: s.step, action: { type: "back" }, mode: "H" });
        s.recording.sink.emit({ type: "effect", step: s.step, result: back });
        const again = await session.computer.observe();
        if (again.ok) current = again.value;
      }
      const corrected: VoiceCommand = {
        verb: last.command.verb,
        ...(last.command.value !== undefined ? { value: last.command.value } : {}),
        ...(command.target ? { target: command.target } : {}),
        ...(command.role ? { role: command.role } : {}),
        ...(command.ordinal !== undefined ? { ordinal: command.ordinal } : {}),
        ...(command.badge !== undefined ? { badge: command.badge } : {}),
        ...(command.deixis ? { deixis: command.deixis } : {}),
        correction: true,
        utterance: command.utterance,
        source: command.source,
      };
      const r = await resolveCommand(corrected, { ...ctx, snapshot: current });
      recordDecision(session, s.step, r.decision);
      if (r.resolution.kind === "action")
        return act(session, s.step, r.resolution, current, s.controller.signal);
      if (r.resolution.kind === "clarify")
        return {
          outcome: "clarify",
          detail: "which one?",
          badges: showBadges(session, current, r.resolution.candidates),
        };
      return {
        outcome: "unresolved",
        detail: r.resolution.kind === "unresolved" ? r.resolution.reason : "cannot correct",
      };
    }
    case "start_recording":
    case "stop_recording":
      return { outcome: "control", detail: "voice sessions are always recorded" };
    case "save_recipe":
      // TODO(phase-3 knowledge): recipes are not implemented yet; the run folder is replayable meanwhile.
      return {
        outcome: "unsupported",
        detail: `recipes are not available yet; replay run ${session.runId} instead`,
      };
    default:
      return { outcome: "unsupported", detail: `"${command.verb}" is not supported on this surface yet` };
  }
}

/** Wraps the session sink for a nested goal run: shifts step numbers and keeps run.end out of the log. */
function nestedSink(session: VoiceSession, offset: number, onEnd: (reason: string) => void): EventSink {
  const sink = session.state.recording.sink;
  const shift = (d: RunEventDraft): RunEventDraft =>
    "step" in d && typeof d.step === "number" ? ({ ...d, step: d.step + offset } as RunEventDraft) : d;
  return {
    emit(draft) {
      if (draft.type === "run.end") {
        onEnd(draft.reason);
        return;
      }
      sink.emit(shift(draft));
    },
    writeScreenshot: (step, bytes) => sink.writeScreenshot?.(step + offset, bytes) ?? "",
    writeState: (step, purpose, state) => sink.writeState?.(step + offset, purpose, state) ?? "",
  };
}

async function runGoal(
  rt: EngineRuntime,
  session: VoiceSession,
  step: number,
  goal: string,
  snapshot: Snapshot,
  signal: AbortSignal,
): Promise<Partial2> {
  const s = session.state;
  if (!s.opts.decision)
    return { outcome: "unresolved", detail: "multi-step requests need the decision model" };
  const task = TaskSpecSchema.parse({
    id: "voice-goal",
    instruction: goal,
    startUrl: snapshot.url ?? "about:blank",
  });
  let endReason = "";
  const result = await runTask(task, {
    computer: session.computer,
    decision: s.opts.decision,
    events: nestedSink(session, step, (reason) => {
      endReason = reason;
    }),
    secrets: rt.secrets,
    config: { gates: rt.config.gates },
    logger: rt.logger.child({ pkg: "core" }),
    skipOpen: true,
    signal,
    ...(s.opts.planner ? { planner: s.opts.planner } : {}),
    ...(s.opts.writer ? { writer: s.opts.writer } : {}),
  });
  s.step += result.steps;
  s.decisionCalls += result.decisionCalls;
  s.modelCalls += result.modelCalls;
  s.costUsd += result.costUsd;
  s.recording.sink.emit({
    type: "human",
    step,
    kind: "input",
    detail: `goal ${result.outcome}: ${endReason || result.reason}`,
  });
  const outcome = signal.aborted ? "aborted" : result.outcome === "success" ? "goal_done" : "goal_failed";
  return { outcome, detail: `${result.outcome}: ${result.reason}`, goal: result };
}
