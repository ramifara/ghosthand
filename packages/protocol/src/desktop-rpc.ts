// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The desktop driver contract: newline-delimited JSON-RPC 2.0 over stdio between the TypeScript client
// (`@ghosthand/driver-desktop`) and one native host per platform (Linux AT-SPI, Windows UIA, macOS AX).
// Hosts report native facts (roles, states, actions, bounds, read-backs); the client maps roles, ranks,
// redacts, issues tokens and judges effects, so that logic exists once.
import { z } from "zod";
import { Rect } from "./geometry.ts";

export const DESKTOP_RPC_VERSION = 1;

export const DesktopPlatform = z.enum(["linux-x11", "linux-wayland", "windows", "macos"]);
export type DesktopPlatform = z.infer<typeof DesktopPlatform>;

// ---- JSON-RPC envelope ------------------------------------------------------------------------------

export const RpcId = z.union([z.number().int(), z.string()]);

export const RpcErrorKind = z.enum([
  "stale_token",
  "not_found",
  "not_interactable",
  "unsupported",
  "launch_failed",
  "permission_denied",
  "timeout",
  "driver",
]);
export type RpcErrorKind = z.infer<typeof RpcErrorKind>;

export const RpcErrorObject = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z
    .object({ kind: RpcErrorKind.catch("driver") })
    .partial()
    .optional(),
});
export type RpcErrorObject = z.infer<typeof RpcErrorObject>;

export const RpcResponse = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: RpcId, result: z.unknown() }),
  z.object({ jsonrpc: z.literal("2.0"), id: RpcId.nullable(), error: RpcErrorObject }),
]);
export type RpcResponse = z.infer<typeof RpcResponse>;

/** Host-initiated messages: `ready` once started, `fatal` when startup failed, `log` for diagnostics. */
export const RpcNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type RpcNotification = z.infer<typeof RpcNotification>;

// ---- shared shapes ----------------------------------------------------------------------------------

/** Native AT-SPI / UIA / AX boundary trust: exact on X11, Windows (DPI-aware) and macOS; none on Wayland. */
export const RpcBoundsTrust = z.enum(["exact", "approximate", "none"]);

/** One accessible node as the host sees it. Values of secret fields are never sent (length only). */
export const RpcNode = z.object({
  /** Index in this snapshot; the client turns it into a token. */
  ref: z.number().int().nonnegative(),
  parent: z.number().int().nonnegative().nullable(),
  depth: z.number().int().nonnegative(),
  /** Native role: AT-SPI role name ("push button"), UIA ControlType ("Button"), AX role ("AXButton"). */
  role: z.string(),
  /** AX subrole or UIA LocalizedControlType, when it refines the role. */
  subrole: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  /** Editable or range value (not for secret fields). */
  value: z.string().optional(),
  /** Length of a secret field's value. */
  valueLength: z.number().int().nonnegative().optional(),
  /** Static text content when it differs from the name. */
  text: z.string().optional(),
  secret: z.boolean().default(false),
  /** Lower-case native state names ("focused", "checked", "editable", "sensitive", "offscreen", ...). */
  states: z.array(z.string()),
  /** Native interfaces / patterns ("Action", "EditableText", "Invoke", "Value", "AXPress", ...). */
  interfaces: z.array(z.string()).default([]),
  /** Native action names ("click", "toggle", "AXPress", ...). */
  actions: z.array(z.string()).default([]),
  /** Screen coordinates in the host's screen space (see `RpcSnapshot.scale`). */
  bounds: Rect.nullable(),
  /** Ref of the top-level window this node belongs to. */
  window: z.number().int().nonnegative(),
  childCount: z.number().int().nonnegative().default(0),
  automationId: z.string().optional(),
  options: z.array(z.string()).optional(),
  optionCount: z.number().int().nonnegative().optional(),
  selectedOption: z.string().optional(),
  range: z.object({ min: z.number(), max: z.number(), step: z.number().optional() }).optional(),
});
export type RpcNode = z.infer<typeof RpcNode>;

/** Read-back of one element around an action (`null` after: the element is gone). */
export const RpcProbe = z.object({
  name: z.string(),
  states: z.array(z.string()),
  value: z.string().optional(),
  valueLength: z.number().int().nonnegative().optional(),
  childCount: z.number().int().nonnegative().optional(),
  selectedOption: z.string().optional(),
});
export type RpcProbe = z.infer<typeof RpcProbe>;

/** Window-level read-back: titles ("role:title"), the active window, the focused element ("role:name"). */
export const RpcGlobalProbe = z.object({
  windows: z.array(z.string()),
  activeWindow: z.string().optional(),
  focused: z.string().optional(),
  /** Accessibility events seen so far (a monotonic counter; growth is weak evidence of change). */
  events: z.number().int().nonnegative().default(0),
  /** Hash of the active window's names and static text (no field values): changes mean visible content changed. */
  contentHash: z.string().optional(),
});
export type RpcGlobalProbe = z.infer<typeof RpcGlobalProbe>;

export const RpcFocusedValue = z.object({
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
  valueLength: z.number().int().nonnegative().optional(),
});
export type RpcFocusedValue = z.infer<typeof RpcFocusedValue>;

// ---- methods ----------------------------------------------------------------------------------------

export const HelloParams = z.object({ client: z.string(), protocolVersion: z.number().int() });
export const HelloResult = z.object({
  protocolVersion: z.number().int(),
  host: z.object({ name: z.string(), version: z.string() }),
  platform: DesktopPlatform,
  capabilities: z.object({
    semanticActions: z.boolean(),
    pointer: z.boolean(),
    screenshots: z.boolean(),
    recording: z.boolean(),
    boundsTrust: RpcBoundsTrust,
    /** Live view URL on 127.0.0.1 (noVNC), when the sandbox runs one. */
    vncUrl: z.string().optional(),
  }),
  /** Screen size in the host's screen units; `scale` = screenshot pixels per screen unit. */
  screen: z.object({ width: z.number(), height: z.number(), scale: z.number().positive() }),
});
export type HelloResult = z.infer<typeof HelloResult>;

export const DoctorResult = z.object({
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
});
export type DoctorResult = z.infer<typeof DoctorResult>;

export const LaunchParams = z.object({
  argv: z.array(z.string()).min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  /** Wait for an accessible window from the process, ms. */
  waitMs: z.number().int().positive().optional(),
});
export type LaunchParams = z.infer<typeof LaunchParams>;
export const LaunchResult = z.object({ pid: z.number().int(), windowTitle: z.string().optional() });
export type LaunchResult = z.infer<typeof LaunchResult>;

export const ObserveParams = z.object({
  /** "app": the launched app's windows (default); "desktop": every accessible app. */
  scope: z.enum(["app", "desktop"]).optional(),
  maxNodes: z.number().int().positive().optional(),
  maxDepth: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** Do not replace the latest snapshot (verification reads): its refs stay valid. */
  transient: z.boolean().optional(),
});
export type ObserveParams = z.infer<typeof ObserveParams>;

export const RpcSnapshot = z.object({
  snapshotId: z.string().min(1),
  takenAt: z.number().int().nonnegative(),
  screen: Rect,
  scale: z.number().positive(),
  /** Title of the active window. */
  title: z.string(),
  appName: z.string().optional(),
  nodes: z.array(RpcNode),
  complete: z.boolean(),
  degradedReason: z.string().optional(),
  walkMs: z.number().nonnegative().optional(),
});
export type RpcSnapshot = z.infer<typeof RpcSnapshot>;

export const ActOp = z.enum([
  "press",
  "set_value",
  "toggle",
  "select_option",
  "focus",
  "scroll_into_view",
  "select_text",
]);
export type ActOp = z.infer<typeof ActOp>;

export const ActParams = z.object({
  snapshotId: z.string().min(1),
  ref: z.number().int().nonnegative(),
  op: ActOp,
  /** set_value: the literal text (secrets are resolved by the client right before this call). */
  value: z.string().optional(),
  checked: z.boolean().optional(),
  option: z.string().optional(),
  text: z.string().optional(),
});
export type ActParams = z.infer<typeof ActParams>;

export const RpcRoute = z.enum(["semantic", "pointer", "keyboard", "none"]);

export const ActResult = z.object({
  ok: z.boolean(),
  route: RpcRoute,
  /** The native path taken, e.g. "atspi.do_action(click)", "uia.invoke", "ax.press", "xtest.click". */
  nativeRoute: z.string(),
  before: RpcProbe.nullable(),
  after: RpcProbe.nullable(),
  globalBefore: RpcGlobalProbe,
  globalAfter: RpcGlobalProbe,
  error: z.object({ kind: RpcErrorKind.catch("driver"), message: z.string() }).optional(),
});
export type ActResult = z.infer<typeof ActResult>;

export const InputOp = z.enum(["click", "move", "drag", "scroll", "type", "key"]);
export type InputOp = z.infer<typeof InputOp>;

/** Synthetic input in screen units (the client maps capture pixels and tokens to screen units). */
export const InputParams = z.object({
  op: InputOp,
  x: z.number().optional(),
  y: z.number().optional(),
  toX: z.number().optional(),
  toY: z.number().optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  count: z.number().int().min(1).max(3).optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
  text: z.string().optional(),
  keys: z.array(z.string()).optional(),
});
export type InputParams = z.infer<typeof InputParams>;

export const InputResult = z.object({
  ok: z.boolean(),
  route: RpcRoute,
  nativeRoute: z.string(),
  globalBefore: RpcGlobalProbe,
  globalAfter: RpcGlobalProbe,
  focusedBefore: RpcFocusedValue.optional(),
  focusedAfter: RpcFocusedValue.optional(),
});
export type InputResult = z.infer<typeof InputResult>;

export const ScreenshotParams = z.object({
  region: Rect.optional(),
  /** Downscale so the longest side is at most this many pixels; `scale` reports the result. */
  maxSide: z.number().int().positive().optional(),
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
});
export type ScreenshotParams = z.infer<typeof ScreenshotParams>;
export const ScreenshotResult = z.object({
  /** Base64 image bytes. */
  data: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scale: z.number().positive(),
});
export type ScreenshotResult = z.infer<typeof ScreenshotResult>;

export const WaitIdleParams = z.object({
  capMs: z.number().int().nonnegative(),
  quietMs: z.number().int().nonnegative().optional(),
});
export const WaitIdleResult = z.object({ waitedMs: z.number().nonnegative(), reason: z.string() });

export const RecordStartParams = z.object({ path: z.string().min(1) });
export const RecordStopResult = z.object({ files: z.array(z.string()) });

export const EmptyResult = z.object({}).passthrough();

/** Every method with its params and result schema; hosts must implement all of them. */
export const DESKTOP_RPC_METHODS = {
  hello: { params: HelloParams, result: HelloResult },
  doctor: { params: z.object({}), result: DoctorResult },
  launch: { params: LaunchParams, result: LaunchResult },
  observe: { params: ObserveParams, result: RpcSnapshot },
  act: { params: ActParams, result: ActResult },
  input: { params: InputParams, result: InputResult },
  screenshot: { params: ScreenshotParams, result: ScreenshotResult },
  wait_idle: { params: WaitIdleParams, result: WaitIdleResult },
  record_start: { params: RecordStartParams, result: EmptyResult },
  record_stop: { params: z.object({}), result: RecordStopResult },
  close: { params: z.object({}), result: EmptyResult },
} as const;

export type DesktopRpcMethod = keyof typeof DESKTOP_RPC_METHODS;
export type DesktopRpcParams<M extends DesktopRpcMethod> = z.input<(typeof DESKTOP_RPC_METHODS)[M]["params"]>;
export type DesktopRpcResult<M extends DesktopRpcMethod> = z.infer<(typeof DESKTOP_RPC_METHODS)[M]["result"]>;
