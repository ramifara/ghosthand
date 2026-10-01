// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The desktop app's typed IPC contract (Phase 2).
//
// Three boundaries use it:
// - renderer → main: `invoke(command, input)`. Main validates every input with `IpcCommands[command].input`
//   and checks the sender frame before doing anything.
// - main ↔ engine host (Electron utilityProcess): `HostRequest` / `HostResponse` / `HostNotice`.
// - engine host → renderer: `EngineMessage` over a MessagePort (run events, screencast frames, approvals).
// Secret values never appear in any renderer-facing shape; only names do.
import { z } from "zod";
import { RunEvent, RunOutcome } from "./events.ts";
import { Rect } from "./geometry.ts";
import { Budget, EffectClass } from "./task.ts";

export const IPC_INVOKE_CHANNEL = "ghosthand:invoke";
export const IPC_PORT_CHANNEL = "ghosthand:engine-port";
export const IPC_PUSH_CHANNEL = "ghosthand:push";

// ---- shared field shapes -------------------------------------------------------------------------

/** Run ids as written by the recorder; safe as a single path segment. */
export const RunId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "invalid run id");
export const TaskId = z.string().regex(/^l\d-[a-z0-9-]{1,80}$/, "invalid testbed task id");
/** Same rule as driver-playwright's profile names: lowercase kebab-case. */
export const ProfileName = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use lowercase letters, digits and single dashes");
/** Secret names as they appear in `[input:NAME]` placeholders and the env file. */
export const SecretName = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/, "use UPPER_SNAKE_CASE (letters, digits, underscores)");
export const HttpUrl = z
  .string()
  .max(2048)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "expected an http(s) URL");
export const ModelRefString = z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._:/-]+$/, "expected provider/model");

export const PlannerChoice = z.enum(["auto", "codex", "models", "none"]);
export type PlannerChoice = z.infer<typeof PlannerChoice>;
export const WriterChoice = z.enum(["auto", "models", "none"]);
export type WriterChoice = z.infer<typeof WriterChoice>;
/** `heuristic` is the hidden "plumbing mode": a rule-based stand-in for Jev, no network, no key. */
export const DecisionChoice = z.enum(["jev", "heuristic"]);
export type DecisionChoice = z.infer<typeof DecisionChoice>;

export const ChatRoleName = z.enum(["planner", "writer", "vision_reviewer", "vision_grounder", "judge"]);
export type ChatRoleName = z.infer<typeof ChatRoleName>;

/** Role → model chain as the settings screen edits it; the engine re-validates against the catalog. */
export const RoleBindingsInput = z.partialRecord(
  ChatRoleName,
  z
    .object({
      models: z.array(ModelRefString).min(1).max(5),
      reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
    })
    .strict(),
);
export type RoleBindingsInput = z.infer<typeof RoleBindingsInput>;

// ---- settings --------------------------------------------------------------------------------------

export const Settings = z
  .object({
    defaultProfile: ProfileName.default("default"),
    budget: Budget.default({ steps: 25, seconds: 180, usd: 0.25 }),
    planner: PlannerChoice.default("auto"),
    writer: WriterChoice.default("auto"),
    showBrowser: z.boolean().default(true),
    /** Hidden developer setting: use the heuristic decision provider when no TypeSafe key is set. */
    devPlumbingMode: z.boolean().default(false),
    /** Feature flag for Sign in with ChatGPT (preview; see docs/adr/0006). */
    chatgptSignIn: z.boolean().default(false),
    /** Keep secrets on disk even when Linux has no keyring (safeStorage `basic_text`). */
    persistWithoutKeyring: z.boolean().default(false),
    roleBindings: RoleBindingsInput.default({}),
  })
  .strict();
export type Settings = z.infer<typeof Settings>;
export const SettingsPatch = Settings.partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const SecretsStatus = z.object({
  names: z.array(SecretName),
  /** safeStorage backend (Linux), or "keychain"/"dpapi" on macOS/Windows. */
  backend: z.string(),
  /** False when values only live in memory for this session. */
  persistent: z.boolean(),
  warning: z.string().optional(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- view models -----------------------------------------------------------------------------------

export const TaskListItem = z.object({
  id: z.string(),
  version: z.number().int(),
  level: z.number().int(),
  start: z.string(),
  instruction: z.string(),
});
export type TaskListItem = z.infer<typeof TaskListItem>;

export const RunListItem = z.object({
  id: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  taskId: z.string().nullable(),
  instruction: z.string().nullable(),
  startUrl: z.string().nullable(),
  outcome: RunOutcome.nullable(),
  reason: z.string().nullable(),
  steps: z.number().int(),
  wallMs: z.number().nullable(),
  costUsd: z.number(),
  decisionCalls: z.number().int(),
  modelCalls: z.number().int(),
  decisionModel: z.string().nullable(),
});
export type RunListItem = z.infer<typeof RunListItem>;

export const RunEventsPage = z.object({
  runId: z.string(),
  events: z.array(RunEvent),
  /** Steps that have a screenshot in the run folder. */
  screenshotSteps: z.array(z.number().int()),
});
export type RunEventsPage = z.infer<typeof RunEventsPage>;

export const DoctorCheckView = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export type DoctorCheckView = z.infer<typeof DoctorCheckView>;

export const ModelListItem = z.object({
  ref: z.string(),
  name: z.string(),
  provider: z.string(),
  contextTokens: z.number(),
  inputPerM: z.number().optional(),
  outputPerM: z.number().optional(),
  roles: z.array(ChatRoleName),
  computerUse: z.boolean(),
  imageInput: z.boolean(),
  structuredOutput: z.boolean(),
  reasoning: z.boolean(),
  /** set: a key or ChatGPT sign-in can call it; missing: needs a key; unsupported: no provider yet. */
  access: z.enum(["set", "missing", "unsupported"]),
});
export type ModelListItem = z.infer<typeof ModelListItem>;

export const ProfileItem = z.object({
  name: z.string(),
  sizeBytes: z.number(),
  lastUsedAt: z.string().optional(),
  importedFrom: z.string().optional(),
});
export type ProfileItem = z.infer<typeof ProfileItem>;

export const ChatGptStatus = z.object({
  /** Feature flag state. */
  enabled: z.boolean(),
  signedIn: z.boolean(),
  /** A sign-in is waiting for the browser callback. */
  pending: z.boolean(),
  expiresAt: z.number().optional(),
  scopes: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type ChatGptStatus = z.infer<typeof ChatGptStatus>;

export const AppInfo = z.object({
  version: z.string(),
  platform: z.string(),
  electron: z.string(),
  secrets: SecretsStatus,
  runsDir: z.string(),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const RunStatus = z.enum(["starting", "running", "paused", "stopping", "ended"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const ActiveRun = z.object({
  runId: z.string(),
  status: RunStatus,
  task: z.object({ id: z.string(), instruction: z.string(), startUrl: z.string() }),
  decision: z.string(),
  startedAt: z.number(),
});
export type ActiveRun = z.infer<typeof ActiveRun>;

export const ApprovalDecision = z.enum(["once", "task", "deny"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalRequestView = z.object({
  requestId: z.string(),
  step: z.number().int(),
  actionType: z.string(),
  target: z
    .object({ role: z.string(), name: z.string(), context: z.string().optional(), bounds: Rect.optional() })
    .nullable(),
  effect: EffectClass,
  goal: z.string(),
  describe: z.string(),
});
export type ApprovalRequestView = z.infer<typeof ApprovalRequestView>;

// ---- start a run -----------------------------------------------------------------------------------

export const RunSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("testbed"), taskId: TaskId }).strict(),
  z
    .object({
      kind: z.literal("goal"),
      goal: z.string().trim().min(1).max(4000),
      startUrl: HttpUrl,
      allowOrigins: z.array(HttpUrl).max(20).default([]),
    })
    .strict(),
]);
export type RunSource = z.infer<typeof RunSource>;

export const StartRunInput = z
  .object({
    source: RunSource,
    profile: ProfileName.optional(),
    planner: PlannerChoice.optional(),
    writer: WriterChoice.optional(),
    decision: DecisionChoice.default("jev"),
    showBrowser: z.boolean().optional(),
  })
  .strict();
export type StartRunInput = z.infer<typeof StartRunInput>;

// ---- renderer → main commands ---------------------------------------------------------------------

const Empty = z.object({}).strict().default({});
const RunRef = z.object({ runId: RunId }).strict();
const Nothing = z.null();

export const IpcCommands = {
  "app.info": { input: Empty, output: AppInfo },
  "runs.start": { input: StartRunInput, output: z.object({ runId: z.string() }) },
  "runs.stop": { input: RunRef, output: Nothing },
  "runs.approve": {
    input: z.object({ requestId: z.string().min(1).max(64), decision: ApprovalDecision }).strict(),
    output: Nothing,
  },
  "runs.takeover": { input: RunRef, output: Nothing },
  "runs.resume": { input: RunRef, output: Nothing },
  "runs.active": { input: Empty, output: ActiveRun.nullable() },
  "runs.list": {
    input: z
      .object({ limit: z.number().int().min(1).max(500).optional(), taskId: TaskId.optional() })
      .strict()
      .default({}),
    output: z.array(RunListItem),
  },
  "runs.get": { input: RunRef, output: RunListItem },
  "runs.events": { input: RunRef, output: RunEventsPage },
  "runs.screenshot": {
    input: z.object({ runId: RunId, step: z.number().int().min(0).max(9999) }).strict(),
    output: z.object({ dataUrl: z.string() }).nullable(),
  },
  "tasks.list": { input: Empty, output: z.array(TaskListItem) },
  "doctor.run": { input: Empty, output: z.array(DoctorCheckView) },
  "settings.get": { input: Empty, output: Settings },
  "settings.set": { input: SettingsPatch, output: Settings },
  "secrets.list": { input: Empty, output: SecretsStatus },
  "secrets.set": {
    input: z.object({ name: SecretName, value: z.string().min(1).max(8192) }).strict(),
    output: SecretsStatus,
  },
  "secrets.delete": { input: z.object({ name: SecretName }).strict(), output: SecretsStatus },
  "models.list": { input: Empty, output: z.array(ModelListItem) },
  "roles.get": { input: Empty, output: RoleBindingsInput },
  "roles.set": { input: RoleBindingsInput, output: RoleBindingsInput },
  "profiles.list": { input: Empty, output: z.array(ProfileItem) },
  "profiles.create": { input: z.object({ name: ProfileName }).strict(), output: ProfileItem },
  "profiles.import": {
    input: z
      .object({
        name: ProfileName,
        /** Chrome profile directory name inside the user-data-dir, e.g. "Default" or "Profile 1". */
        chromeProfile: z
          .string()
          .regex(/^[A-Za-z0-9 _-]{1,64}$/)
          .default("Default"),
      })
      .strict(),
    output: ProfileItem,
  },
  "chatgpt.status": { input: Empty, output: ChatGptStatus },
  "chatgpt.signIn": { input: Empty, output: ChatGptStatus },
  "chatgpt.completeManual": { input: z.object({ url: HttpUrl }).strict(), output: ChatGptStatus },
  "chatgpt.cancel": { input: Empty, output: ChatGptStatus },
  "chatgpt.signOut": { input: Empty, output: ChatGptStatus },
  "shell.openExternal": { input: z.object({ url: HttpUrl }).strict(), output: Nothing },
} as const satisfies Record<string, { input: z.ZodType; output: z.ZodType }>;

export type IpcCommandName = keyof typeof IpcCommands;
export type IpcInput<K extends IpcCommandName> = z.input<(typeof IpcCommands)[K]["input"]>;
export type IpcParsedInput<K extends IpcCommandName> = z.output<(typeof IpcCommands)[K]["input"]>;
export type IpcOutput<K extends IpcCommandName> = z.output<(typeof IpcCommands)[K]["output"]>;

export const IPC_COMMAND_NAMES = Object.keys(IpcCommands) as IpcCommandName[];

export const IpcErrorKind = z.enum([
  "invalid_input",
  "forbidden_sender",
  "unknown_command",
  "not_found",
  "busy",
  "unavailable",
  "engine",
  "internal",
]);
export type IpcErrorKind = z.infer<typeof IpcErrorKind>;
export const IpcError = z.object({ kind: IpcErrorKind, message: z.string() });
export type IpcError = z.infer<typeof IpcError>;

export type IpcResponse<T> = { ok: true; value: T } | { ok: false; error: IpcError };
export const IpcResponseEnvelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), error: IpcError }),
]);

export const isIpcCommandName = (name: unknown): name is IpcCommandName =>
  typeof name === "string" && Object.hasOwn(IpcCommands, name);

/** Validates an incoming renderer request. Never throws. */
export function parseIpcRequest(
  command: unknown,
  input: unknown,
): { ok: true; value: { command: IpcCommandName; input: unknown } } | { ok: false; error: IpcError } {
  if (!isIpcCommandName(command)) {
    return { ok: false, error: { kind: "unknown_command", message: `unknown command ${String(command)}` } };
  }
  const parsed = IpcCommands[command].input.safeParse(input ?? undefined);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      error: { kind: "invalid_input", message: `${command}: ${where}${issue?.message ?? "invalid input"}` },
    };
  }
  return { ok: true, value: { command, input: parsed.data } };
}

// ---- engine host → renderer (MessagePort) --------------------------------------------------------

export const ScreencastMetadata = z.object({
  /** CSS pixels of the page viewport the frame shows. */
  deviceWidth: z.number().positive(),
  deviceHeight: z.number().positive(),
  offsetTop: z.number(),
  pageScaleFactor: z.number().positive(),
  scrollOffsetX: z.number(),
  scrollOffsetY: z.number(),
  timestamp: z.number().optional(),
});
export type ScreencastMetadata = z.infer<typeof ScreencastMetadata>;

export const ScreencastFrame = z.object({
  /** Base64 image bytes. */
  data: z.string(),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  metadata: ScreencastMetadata,
});
export type ScreencastFrame = z.infer<typeof ScreencastFrame>;

export const EngineMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello"), version: z.string() }),
  z.object({ kind: z.literal("run.event"), runId: z.string(), event: RunEvent }),
  z.object({ kind: z.literal("frame"), runId: z.string(), frame: ScreencastFrame }),
  z.object({ kind: z.literal("approval.request"), runId: z.string(), request: ApprovalRequestView }),
  z.object({
    kind: z.literal("approval.resolved"),
    runId: z.string(),
    requestId: z.string(),
    decision: ApprovalDecision,
  }),
  z.object({
    kind: z.literal("status"),
    runId: z.string(),
    status: RunStatus,
    detail: z.string().optional(),
    outcome: RunOutcome.optional(),
    oraclePass: z.boolean().optional(),
  }),
]);
export type EngineMessage = z.infer<typeof EngineMessage>;

// ---- main → renderer push --------------------------------------------------------------------------

export const PushMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("engine"), state: z.enum(["ready", "crashed", "restarting"]) }),
  z.object({ kind: z.literal("hotkey"), action: z.literal("takeover-toggle") }),
  z.object({ kind: z.literal("chatgpt"), status: ChatGptStatus }),
]);
export type PushMessage = z.infer<typeof PushMessage>;

// ---- main ↔ engine host ----------------------------------------------------------------------------

/** Credentials main hands the engine host for one call. Never sent to the renderer. */
export const HostCredentials = z.object({
  /** Provider keys and agent secrets by name (TYPESAFE_API_KEY, OPENAI_API_KEY, site passwords...). */
  secrets: z.record(SecretName, z.string()),
  /** Short-lived SIWC access token when the ChatGPT plan is signed in. */
  chatgptAccessToken: z.string().optional(),
});
export type HostCredentials = z.infer<typeof HostCredentials>;

export const HostCommandName = z.enum([
  "runs.start",
  "runs.stop",
  "runs.approve",
  "runs.takeover",
  "runs.resume",
  "runs.toggleTakeover",
  "runs.active",
  "runs.list",
  "runs.get",
  "runs.events",
  "runs.screenshot",
  "tasks.list",
  "doctor.run",
  "models.list",
  "profiles.list",
  "profiles.create",
  "profiles.import",
  "app.runsDir",
]);
export type HostCommandName = z.infer<typeof HostCommandName>;

export const HostRequest = z.object({
  kind: z.literal("request"),
  id: z.number().int().nonnegative(),
  command: HostCommandName,
  input: z.unknown(),
  /** Settings snapshot for commands that need it (runs.start, models.list). */
  settings: Settings.optional(),
  credentials: HostCredentials.optional(),
});
export type HostRequest = z.infer<typeof HostRequest>;

export const HostResponse = z.object({
  kind: z.literal("response"),
  id: z.number().int().nonnegative(),
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: IpcError.optional(),
});
export type HostResponse = z.infer<typeof HostResponse>;

/** Unprompted host → main messages (main tracks run state for the global takeover hotkey). */
export const HostNotice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("run.status"), runId: z.string(), status: RunStatus }),
]);
export type HostNotice = z.infer<typeof HostNotice>;

/** Main → host: hands over the renderer's MessagePort (sent with the port in `ports`). */
export const HostPortHandoff = z.object({ kind: z.literal("port") });

/** What preload exposes as `window.ghosthand`. */
export interface GhostHandBridge {
  invoke<K extends IpcCommandName>(command: K, input?: IpcInput<K>): Promise<IpcResponse<IpcOutput<K>>>;
  /** Engine messages (validated by the caller). Returns an unsubscribe function. */
  onEngineMessage(listener: (message: unknown) => void): () => void;
  /** Main-process pushes. Returns an unsubscribe function. */
  onPush(listener: (message: unknown) => void): () => void;
  readonly platform: string;
}
