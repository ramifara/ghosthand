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
  /** Goal words: on a long page, text lines that contain them are kept after the opening excerpt. */
  focus?: readonly string[];
  /** Text lines that appeared since the previous observation (what the last action produced). */
  newText?: readonly string[];
}

/** Characters of `new_text` in the state. */
export const MAX_NEW_TEXT_CHARS = 600;

/** New lines beyond this share of the page (or MIN_CHANGED_LINES) mean a different page, not a change. */
const MAX_CHANGED_SHARE = 0.25;
const MIN_CHANGED_LINES = 4;

/**
 * Lines of `text` that are not in `before` (trimmed, non-empty), in page order: what the last action
 * produced on the same page ("Order ord_1042 restored."). Empty on the first observation and when most of
 * the page is new (another page or a closed dialog), where listing it would only repeat the page.
 */
export function newTextLines(before: string | undefined, text: string): string[] {
  if (before === undefined) return [];
  const seen = new Set(before.split(/\n+/).map((l) => l.trim()));
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) if (!seen.has(line) && !out.includes(line)) out.push(line);
  const limit = Math.max(MIN_CHANGED_LINES, Math.floor(lines.length * MAX_CHANGED_SHARE));
  return out.length > limit ? [] : out;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Shares of a long page's text budget: its start, and its end (where results of an action often appear). */
const TEXT_HEAD_SHARE = 0.55;
const TEXT_TAIL_SHARE = 0.2;
const MAX_FOCUS_LINE_CHARS = 200;

/**
 * Page text within `max` characters. A long page keeps its start, then the lines naming the most goal
 * words (in page order), then its end, joined with " … ". Without goal words and `tail`, it is clipped.
 */
export function pageTextExcerpt(
  text: string,
  max: number,
  focus: readonly string[] = [],
  opts: { tail?: boolean } = {},
): string {
  if (text.length <= max || (focus.length === 0 && !opts.tail)) return clip(text, max);
  const head = text.slice(0, Math.floor(max * TEXT_HEAD_SHARE));
  const tailChars = opts.tail ? Math.floor(max * TEXT_TAIL_SHARE) : 0;
  const tail = tailChars > 0 ? text.slice(-tailChars) : "";
  const middle = text.slice(head.length, text.length - tail.length);
  const lines = middle
    .split(/\n+/)
    .map((l, i) => {
      const line = l.trim();
      const lower = line.toLowerCase();
      return { line, i, hits: focus.filter((t) => lower.includes(t)).length };
    })
    .filter((x) => x.line.length > 0 && x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.i - b.i);
  const picked: typeof lines = [];
  let budget = max - head.length - tail.length - 4;
  for (const x of lines) {
    const cost = Math.min(x.line.length, MAX_FOCUS_LINE_CHARS) + 3;
    if (cost > budget) continue;
    picked.push(x);
    budget -= cost;
  }
  picked.sort((a, b) => a.i - b.i);
  const focused = picked.map((x) => ` ${clip(x.line, MAX_FOCUS_LINE_CHARS)} …`).join("");
  return `${head}…${focused}${tail ? ` ${tail}` : ""}`;
}

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
    texts: pageTextExcerpt(snapshot.text, MAX_PAGE_TEXT_CHARS, input.focus),
    ...(input.newText && input.newText.length > 0
      ? { new_text: clip(input.newText.join(" | "), MAX_NEW_TEXT_CHARS) }
      : {}),
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
