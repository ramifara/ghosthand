// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Mode D2 over the models layer: one screenshot + goal + short history → ONE next action, from a vendor
// computer-use tool (Anthropic toolset/computer, OpenAI Responses `computer`) or a JSON answer on the
// model's grid. Stateless per step: the loop re-observes after every action. We never execute anything
// here and never acknowledge provider safety checks: a pending check comes back as `safety`.
import type { DriveAction } from "@ghosthand/core";
import { err, ok, type Result } from "@ghosthand/protocol";
import { z } from "zod";
import type { CallPlan, CallTarget, ModelClient, PlanRead, ToolCallOutput } from "../model-client.ts";
import type { ModelError } from "../model-error.ts";
import { anthropicImageScale, toImagePixels } from "./grounding-geometry.ts";
import { GROUNDING_GUARD, type GroundScreenshot } from "./vision-grounder.ts";

export interface DriveRequest {
  readonly screenshot: GroundScreenshot;
  readonly goal: string;
  readonly history: readonly string[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface DriveOutcome {
  readonly action: DriveAction;
  readonly model: string;
  readonly latencyMs: number;
  readonly costUsd: number;
}

export interface VisionDriver {
  readonly id: string;
  next(request: DriveRequest): Promise<Result<DriveOutcome, ModelError>>;
}

export const DRIVER_SYSTEM = `You operate a computer for a user, one action at a time, toward the user's goal. ${GROUNDING_GUARD}`;

export function drivePrompt(
  goal: string,
  history: readonly string[],
  size: { width: number; height: number },
): string {
  return [
    `Goal: ${goal}`,
    `Recent actions (oldest first): ${history.length > 0 ? history.join(" | ") : "none"}`,
    `The attached screenshot (${size.width}×${size.height} pixels) is the current screen. Do not take another screenshot.`,
    "Perform exactly ONE next action toward the goal. Type only text the goal states; never invent passwords or codes.",
    "If the goal is already reached or cannot progress, do not call the tool; reply in one sentence starting with DONE.",
    GROUNDING_GUARD,
  ].join("\n");
}

type Pt = { x: number; y: number };
const Coord = z.tuple([z.number(), z.number()]);
const AnthropicInput = z.object({
  action: z.string(),
  coordinate: Coord.optional(),
  start_coordinate: Coord.optional(),
  text: z.string().optional(),
  scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
  scroll_amount: z.number().optional(),
});

const done = (output: ToolCallOutput, fallback: string): PlanRead<DriveAction> =>
  ok({ kind: "done", reason: output.text.trim().slice(0, 300) || fallback });

/** Anthropic computer actions → one DriveAction in the model's coordinate space. */
export function readAnthropicDrive(output: ToolCallOutput, toolName: string): PlanRead<DriveAction> {
  const call = output.toolCalls.find((c) => c.toolName === toolName);
  if (!call) return done(output, "the model made no computer action");
  const p = AnthropicInput.safeParse(call.input);
  if (!p.success) return err({ kind: "schema_failed", message: "computer action input did not parse" });
  const { action, coordinate, start_coordinate, text } = p.data;
  const at = coordinate ? { x: coordinate[0], y: coordinate[1] } : undefined;
  switch (action) {
    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click":
    case "middle_click":
      if (!at) return err({ kind: "schema_failed", message: `${action} without a coordinate` });
      return ok({
        kind: "click",
        ...at,
        ...(action === "right_click" ? { button: "right" as const } : {}),
        ...(action === "double_click" ? { count: 2 } : action === "triple_click" ? { count: 3 } : {}),
      });
    case "type":
      return text === undefined
        ? err({ kind: "schema_failed", message: "type without text" })
        : ok({ kind: "type", text });
    case "key":
      return text === undefined
        ? err({ kind: "schema_failed", message: "key without keys" })
        : ok({
            kind: "key",
            keys: text
              .split("+")
              .map((k) => k.trim())
              .filter(Boolean),
          });
    case "scroll": {
      if (!at) return err({ kind: "schema_failed", message: "scroll without a coordinate" });
      const amount = (p.data.scroll_amount ?? 3) * 100;
      const dir = p.data.scroll_direction ?? "down";
      return ok({
        kind: "scroll",
        ...at,
        dx: dir === "left" ? -amount : dir === "right" ? amount : 0,
        dy: dir === "up" ? -amount : dir === "down" ? amount : 0,
      });
    }
    case "left_click_drag":
      if (!at || !start_coordinate)
        return err({ kind: "schema_failed", message: "drag without coordinates" });
      return ok({ kind: "drag", from: { x: start_coordinate[0], y: start_coordinate[1] }, to: at });
    default:
      return done(output, `the model chose ${action}, which D2 does not execute`);
  }
}

const OpenAIAction = z.object({
  type: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  button: z.string().optional(),
  text: z.string().optional(),
  keys: z.array(z.string()).optional(),
  scroll_x: z.number().optional(),
  scroll_y: z.number().optional(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  path: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
});
const OpenAIInput = z.object({
  actions: z.array(OpenAIAction).optional(),
  action: OpenAIAction.optional(),
  pendingSafetyChecks: z.array(z.unknown()).default([]),
});

/** OpenAI Responses `computer_call` → one DriveAction. Pending safety checks become `safety`. */
export function readOpenAIDrive(output: ToolCallOutput, toolName: string): PlanRead<DriveAction> {
  const call = output.toolCalls.find((c) => c.toolName === toolName);
  if (!call) return done(output, "the model made no computer call");
  const p = OpenAIInput.safeParse(call.input);
  if (!p.success) return err({ kind: "schema_failed", message: "computer_call input did not parse" });
  if (p.data.pendingSafetyChecks.length > 0)
    return ok({ kind: "safety", reason: "the provider raised a safety check; a human must review" });
  const a = p.data.actions?.[0] ?? p.data.action;
  if (!a) return done(output, "the computer call had no action");
  const at = a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : undefined;
  switch (a.type) {
    case "click":
    case "double_click":
      if (!at) return err({ kind: "schema_failed", message: "click without a point" });
      return ok({
        kind: "click",
        ...at,
        ...(a.button === "right" ? { button: "right" as const } : {}),
        ...(a.type === "double_click" ? { count: 2 } : {}),
      });
    case "type":
      return a.text === undefined
        ? err({ kind: "schema_failed", message: "type without text" })
        : ok({ kind: "type", text: a.text });
    case "keypress":
      return ok({ kind: "key", keys: a.keys ?? [] });
    case "scroll":
      return ok({
        kind: "scroll",
        ...(at ?? { x: 0, y: 0 }),
        dx: a.scroll_x ?? a.scrollX ?? 0,
        dy: a.scroll_y ?? a.scrollY ?? 0,
      });
    case "drag": {
      const first = a.path?.[0];
      const last = a.path?.at(-1);
      if (!first || !last) return err({ kind: "schema_failed", message: "drag without a path" });
      return ok({ kind: "drag", from: first, to: last });
    }
    default:
      return done(output, `the model chose ${a.type}, which D2 does not execute`);
  }
}

export const JsonDriveAnswer = z.object({
  action: z.enum(["click", "right_click", "double_click", "type", "key", "scroll", "drag", "done"]),
  x: z.number().nullable(),
  y: z.number().nullable(),
  to_x: z.number().nullable(),
  to_y: z.number().nullable(),
  text: z.string().nullable(),
  reason: z.string(),
});

function readJsonDrive(value: unknown): PlanRead<DriveAction> {
  const p = JsonDriveAnswer.safeParse(value);
  if (!p.success) return err({ kind: "schema_failed", message: "drive answer did not match the schema" });
  const a = p.data;
  const at = a.x !== null && a.y !== null ? { x: a.x, y: a.y } : undefined;
  switch (a.action) {
    case "done":
      return ok({ kind: "done", reason: a.reason || "done" });
    case "type":
      return a.text
        ? ok({ kind: "type", text: a.text })
        : err({ kind: "schema_failed", message: "type without text" });
    case "key":
      return a.text
        ? ok({ kind: "key", keys: a.text.split("+") })
        : err({ kind: "schema_failed", message: "key without keys" });
    case "drag":
      return at && a.to_x !== null && a.to_y !== null
        ? ok({ kind: "drag", from: at, to: { x: a.to_x, y: a.to_y } })
        : err({ kind: "schema_failed", message: "drag without points" });
    case "scroll":
      return at
        ? ok({ kind: "scroll", ...at, dx: 0, dy: 600 })
        : err({ kind: "schema_failed", message: "scroll without a point" });
    default:
      return at
        ? ok({
            kind: "click",
            ...at,
            ...(a.action === "right_click" ? { button: "right" as const } : {}),
            ...(a.action === "double_click" ? { count: 2 } : {}),
          })
        : err({ kind: "schema_failed", message: "click without a point" });
  }
}

/** Converts every point of an action with `convert`. */
export function mapPoints(a: DriveAction, convert: (p: Pt) => Pt): DriveAction {
  switch (a.kind) {
    case "click":
      return { ...a, ...convert(a) };
    case "scroll":
      return { ...a, ...convert(a) };
    case "drag":
      return { ...a, from: convert(a.from), to: convert(a.to) };
    default:
      return a;
  }
}

function plan(target: CallTarget, req: DriveRequest): CallPlan<DriveAction> {
  const tool = target.model.computerUse;
  const { screenshot } = req;
  if (tool !== undefined && tool !== "gemini_computer_use") {
    const isAnthropic = tool !== "openai_computer";
    const scale = isAnthropic ? anthropicImageScale(screenshot) : 1;
    const display = {
      width: Math.round(screenshot.width * scale),
      height: Math.round(screenshot.height * scale),
    };
    const set = target.provider.nativeComputerTool?.(tool, display);
    if (set) {
      const convert = (p: Pt) => toImagePixels({ x: p.x / scale, y: p.y / scale }, "pixels", screenshot);
      return {
        kind: "tools",
        tools: set.tools,
        toolChoice: "auto",
        prompt: drivePrompt(req.goal, req.history, display),
        system: DRIVER_SYSTEM,
        read: (output) => {
          const r = isAnthropic
            ? readAnthropicDrive(output, set.toolName)
            : readOpenAIDrive(output, set.toolName);
          return r.ok ? ok(mapPoints(r.value, convert)) : r;
        },
      };
    }
  }
  const convention = target.model.grounding;
  const convert = (p: Pt) => toImagePixels(p, convention, screenshot);
  return {
    kind: "object",
    schema: JsonDriveAnswer,
    schemaName: "next_action",
    system: DRIVER_SYSTEM,
    prompt: `${drivePrompt(req.goal, req.history, screenshot)}\nAnswer with the action and its point(s) on the model grid (${convention}); use action "done" to stop.`,
    read: (value) => {
      const r = readJsonDrive(value);
      return r.ok ? ok(mapPoints(r.value, convert)) : r;
    },
  };
}

export function createVisionDriver(options: { client: ModelClient }): VisionDriver {
  return {
    id: "models:vision_driver",
    async next(req: DriveRequest): Promise<Result<DriveOutcome, ModelError>> {
      const r = await options.client.generateWith<DriveAction>(
        {
          role: "vision_grounder",
          prompt: req.goal,
          images: [{ data: req.screenshot.data, mediaType: req.screenshot.mediaType, detail: "original" }],
          ...(req.signal ? { signal: req.signal } : {}),
          ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
        },
        (target) => plan(target, req),
      );
      if (!r.ok) return r;
      return ok({
        action: r.value.value,
        model: r.value.model,
        latencyMs: r.value.latencyMs,
        costUsd: r.value.costUsd,
      });
    },
  };
}
