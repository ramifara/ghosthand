// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Renders a snapshot, the goal and recent history into the state object Jev evaluates.
// Key order is stable on purpose: the model is sensitive to request shape.
import type { Element, JsonValue, RegionSummary, Snapshot } from "@ghosthand/protocol";
import type { SecretsRegistry } from "./secrets.ts";

export const HISTORY_WINDOW = 8;
export const MAX_PAGE_TEXT_CHARS = 2400;
export const MAX_NAME_CHARS = 80;
export const MAX_CONTEXT_CHARS = 160;

export interface HistoryEntry {
  step: number;
  /** e.g. `set_value "Email" ← lit_1 (confirmed)`; never contains secret values. */
  text: string;
}

export interface StateInput {
  instruction: string;
  goal: string;
  step: number;
  phase: "act" | "verify" | "narrow";
  snapshot: Snapshot;
  /** Elements to include (already filtered/ranked); defaults to every element. */
  elements?: Element[];
  history: HistoryEntry[];
  /** Secret names available to the agent (values are never included). */
  inputs: string[];
  /** Extra hint from the writer (Phase 1); evidence like everything else. */
  hint?: string;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function pagePath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

export function renderElement(el: Element): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {
    id: el.token,
    role: el.role,
    name: clip(el.name, MAX_NAME_CHARS),
  };
  if (el.context) out.context = clip(el.context, MAX_CONTEXT_CHARS);
  out.region = el.region;
  if (el.frame !== "main") out.frame = el.frame;
  out.ops = el.actions.filter((a) => a !== "focus" && a !== "scroll_into_view");
  const states = el.states.filter((s) => s !== "focused" || el.roleClass === "textbox");
  if (states.length > 0) out.state = states;
  if (el.value !== undefined) out.value = clip(el.value, MAX_NAME_CHARS);
  if (el.href) out.href = el.href;
  if (el.options) {
    out.options = el.options.slice(0, 16);
    if ((el.optionCount ?? el.options.length) > 16) out.option_count = el.optionCount ?? el.options.length;
  }
  return out;
}

export function buildState(input: StateInput, registry?: SecretsRegistry): Record<string, JsonValue> {
  const { snapshot } = input;
  const elements = input.elements ?? snapshot.elements;
  const omitted = snapshot.elements.length - elements.length;
  const page: Record<string, JsonValue> = {};
  const path = pagePath(snapshot.url);
  if (path) page.url = path;
  page.title = snapshot.title;
  page.dialog_open = snapshot.elements.some((e) => e.region === "dialog");
  if (snapshot.narrowed) page.narrowed = true;
  if (snapshot.scope !== undefined)
    page.region = snapshot.regions?.find((r) => r.id === snapshot.scope)?.label ?? snapshot.scope;
  if (omitted > 0) page.omitted_elements = omitted;

  const task: Record<string, JsonValue> = {
    instruction: input.instruction,
    goal: input.goal,
    step: input.step,
    phase: input.phase,
  };
  if (input.hint) task.hint = input.hint;

  const state: Record<string, JsonValue> = {
    task,
    page,
    elements: elements.map(renderElement),
    texts: clip(snapshot.text, MAX_PAGE_TEXT_CHARS),
    inputs: input.inputs.map((name) => `[input:${name}]`),
    history: input.history.slice(-HISTORY_WINDOW).map((h) => `${h.step}. ${h.text}`),
  };
  return registry ? registry.redactValue(state) : state;
}

/** One line per region for the narrowing question and its state. */
export function describeRegion(r: RegionSummary): string {
  const sample = (r.sample ?? []).map((n) => clip(n, 40)).join(", ");
  return `${r.kind} ${JSON.stringify(clip(r.label, MAX_NAME_CHARS))} · ${r.elementCount} elements${sample ? ` · e.g. ${sample}` : ""}`;
}

/** State for the region choice: the task, the page, its regions and a short text excerpt. */
export function buildNarrowState(
  input: Omit<StateInput, "phase" | "elements">,
  registry?: SecretsRegistry,
): Record<string, JsonValue> {
  const { snapshot } = input;
  const page: Record<string, JsonValue> = {};
  const path = pagePath(snapshot.url);
  if (path) page.url = path;
  page.title = snapshot.title;
  page.element_count = snapshot.elements.length;
  const task: Record<string, JsonValue> = {
    instruction: input.instruction,
    goal: input.goal,
    step: input.step,
    phase: "narrow",
  };
  if (input.hint) task.hint = input.hint;
  const state: Record<string, JsonValue> = {
    task,
    page,
    regions: (snapshot.regions ?? []).map((r) => ({ id: r.id, region: describeRegion(r) })),
    texts: clip(snapshot.text, 1200),
    history: input.history.slice(-HISTORY_WINDOW).map((h) => `${h.step}. ${h.text}`),
  };
  return registry ? registry.redactValue(state) : state;
}

/** Conservative token estimate (no tokenizer is published): characters / 3. */
export const estimateTokens = (value: unknown): number =>
  Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 3);
