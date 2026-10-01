// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Reads the first pointer action out of a vendor computer-use tool call. We never execute the
// action and never send a tool result back: the call is only a way to get a grounded point.
import { z } from "zod";
import type { NativeComputerTool } from "../catalog/ghosthand-fields.ts";
import type { PlanRead, ToolCallOutput } from "../model-client.ts";

/** A point in the model's coordinate space plus the action it came from. */
export interface NativePoint {
  readonly x: number;
  readonly y: number;
  readonly action: string;
}

/** `null` point: the model answered but chose no pointer action (with the reason). */
export type NativeRead = { readonly point: NativePoint } | { readonly point: null; readonly reason: string };

const Coordinate = z.tuple([z.number(), z.number()]);
const AnthropicInput = z.object({
  action: z.string(),
  coordinate: Coordinate.optional(),
  start_coordinate: Coordinate.optional(),
});

const POINTER_ACTIONS_ANTHROPIC = new Set([
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "mouse_move",
  "left_click_drag",
  "scroll",
]);

const OpenAIAction = z.object({
  type: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  path: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
});
const OpenAIInput = z.object({
  actions: z.array(OpenAIAction),
  pendingSafetyChecks: z.array(z.unknown()).default([]),
});

function noPointer(output: ToolCallOutput, fallback: string): PlanRead<NativeRead> {
  const text = output.text.trim();
  return { ok: true, value: { point: null, reason: text === "" ? fallback : text.slice(0, 300) } };
}

export function readAnthropicCall(output: ToolCallOutput, toolName: string): PlanRead<NativeRead> {
  const calls = output.toolCalls.filter((c) => c.toolName === toolName);
  if (calls.length === 0) return noPointer(output, "the model made no computer action");
  for (const call of calls) {
    const parsed = AnthropicInput.safeParse(call.input);
    if (!parsed.success) {
      return { ok: false, error: { kind: "schema_failed", message: "computer action input did not parse" } };
    }
    const { action, coordinate, start_coordinate } = parsed.data;
    if (!POINTER_ACTIONS_ANTHROPIC.has(action)) continue;
    // A drag targets where it starts.
    const at = action === "left_click_drag" ? (start_coordinate ?? coordinate) : coordinate;
    if (at !== undefined) return { ok: true, value: { point: { x: at[0], y: at[1], action } } };
  }
  return noPointer(
    output,
    `the model chose ${calls.map((c) => AnthropicInput.safeParse(c.input).data?.action ?? "?").join(", ")} instead of a pointer action`,
  );
}

export function readOpenAICall(output: ToolCallOutput, toolName: string): PlanRead<NativeRead> {
  const call = output.toolCalls.find((c) => c.toolName === toolName);
  if (call === undefined) return noPointer(output, "the model made no computer call");
  const parsed = OpenAIInput.safeParse(call.input);
  if (!parsed.success) {
    return { ok: false, error: { kind: "schema_failed", message: "computer_call input did not parse" } };
  }
  // Never acknowledge safety checks on the user's behalf: a pending check means a human decides.
  if (parsed.data.pendingSafetyChecks.length > 0) {
    return {
      ok: true,
      value: { point: null, reason: "the provider raised a safety check; a human must review" },
    };
  }
  for (const a of parsed.data.actions) {
    if (a.x !== undefined && a.y !== undefined)
      return { ok: true, value: { point: { x: a.x, y: a.y, action: a.type } } };
    const first = a.path?.[0];
    if (first !== undefined)
      return { ok: true, value: { point: { x: first.x, y: first.y, action: a.type } } };
  }
  return noPointer(
    output,
    `the model chose ${parsed.data.actions.map((a) => a.type).join(", ") || "no action"}`,
  );
}

export function readNativeCall(
  tool: NativeComputerTool,
  output: ToolCallOutput,
  toolName: string,
): PlanRead<NativeRead> {
  return tool === "openai_computer" ? readOpenAICall(output, toolName) : readAnthropicCall(output, toolName);
}
