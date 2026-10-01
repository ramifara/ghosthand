// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Utterance → executable step. Tier 1 grammar, then code-side target resolution (badges, deixis, ordinals,
// exact names), then one Jev request for whatever is still open, then the planner for multi-step goals.
// Risky effects (commit/forbidden, via core combineEffect) come back with needsConfirmation.
import {
  AMBIGUOUS,
  buildCandidates,
  type CandidateTable,
  choiceConfidence,
  combineEffect,
  emptyCandidates,
  NONE,
  type Operation,
} from "@ghosthand/core";
import type {
  Action,
  Answer,
  DecisionError,
  DecisionProvider,
  DecisionResponse,
  EffectClass,
  Element,
  Questions,
  Snapshot,
  VoiceCommand,
  VoiceVerb,
} from "@ghosthand/protocol";
import { VoiceVerb as VoiceVerbSchema } from "@ghosthand/protocol";
import type { FocusStack } from "./focus-stack.ts";
import { type ParseResult, parseUtterance } from "./grammar.ts";
import { buildVoiceDecision, INTENT_HEAD, VERB_OPERATION, voiceTargetHead } from "./intent-questions.ts";

export const SCROLL_STEP_PX = 400;

/** Verbs handled by the session (overlay, dialogue, recording) rather than by an element action. */
export const CONTROL_VERBS: ReadonlySet<VoiceVerb> = new Set<VoiceVerb>([
  "stop",
  "cancel",
  "undo",
  "wait",
  "continue",
  "confirm",
  "deny",
  "repeat",
  "correct",
  "help",
  "show_numbers",
  "hide_numbers",
  "show_grid",
  "start_recording",
  "stop_recording",
  "save_recipe",
  "new_tab",
  "close_tab",
  "forward",
]);

export type ResolvedVia = "badge" | "deixis" | "ordinal" | "name" | "jev" | "focus" | "none";

export type VoiceResolution =
  | {
      kind: "action";
      command: VoiceCommand;
      action: Action;
      element?: Element;
      effect: EffectClass;
      /** Commit or forbidden: show the confirm card; forbidden also needs a key press or click. */
      needsConfirmation: boolean;
      via: ResolvedVia;
    }
  | { kind: "control"; command: VoiceCommand }
  | { kind: "goal"; goal: string; command?: VoiceCommand }
  /** Several elements fit: show numbers on them and ask "which one?". */
  | { kind: "clarify"; command: VoiceCommand; candidates: Element[]; reason: string }
  | { kind: "unresolved"; command?: VoiceCommand; reason: string };

/** What was asked of Jev, for the run record. */
export interface VoiceDecisionTrace {
  questions: Questions;
  response?: DecisionResponse;
  error?: DecisionError;
}

export interface ResolveContext {
  snapshot: Snapshot;
  focus: FocusStack;
  /** Jev; without it, unknown utterances go to the planner and unclear targets come back as clarify. */
  decision?: DecisionProvider;
  thresholds?: { intent: number; target: number };
  signal?: AbortSignal;
}

export interface ResolveOutput {
  parse: ParseResult;
  resolution: VoiceResolution;
  decision?: VoiceDecisionTrace;
}

const DEFAULT_THRESHOLDS = { intent: 0.65, target: 0.7 };

// ---------------------------------------------------------------------------------------------------------
// Code-side target resolution

export const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const roleMatches = (el: Element, role: string | undefined): boolean => {
  if (!role) return true;
  if (role === "textbox")
    return el.roleClass === "textbox" || el.role === "searchbox" || el.role === "combobox";
  if (role === "listitem") return ["listitem", "row", "option", "article", "link"].includes(el.role);
  return el.role === role || el.roleClass === role;
};

const nameHit = (el: Element, words: string): boolean => {
  const n = normalizeName(`${el.name} ${el.context ?? ""}`);
  return words.split(" ").every((w) => n.includes(w));
};

const wordHit = (el: Element, words: string): boolean => {
  if (!words) return false;
  const have = new Set(normalizeName(el.name).split(" "));
  return words.split(" ").every((w) => have.has(w));
};

export type CodeTarget =
  | { kind: "element"; element: Element; via: ResolvedVia }
  | { kind: "candidates"; elements: Element[] }
  | { kind: "missing"; reason: string };

/** Resolves badge, deixis, ordinal and exact-name targets without a model call. */
export function resolveTargetInCode(
  command: VoiceCommand,
  pool: readonly Element[],
  snapshot: Snapshot,
  focus: FocusStack,
): CodeTarget {
  if (command.badge !== undefined) {
    const el = focus.badge(command.badge, snapshot);
    if (el) return { kind: "element", element: el, via: "badge" };
    // Never guess what an unshown number points at.
    return {
      kind: "missing",
      reason: focus.badgesShown
        ? `no element has badge ${command.badge}`
        : `numbers are not shown; say "show numbers" first`,
    };
  }
  // Ordinals and neighbours follow reading (document) order, not candidate rank.
  const docIndex = new Map(snapshot.elements.map((e, i) => [e.stableId, i]));
  const byRole = pool
    .filter((e) => roleMatches(e, command.role))
    .sort((a, b) => (docIndex.get(a.stableId) ?? 0) - (docIndex.get(b.stableId) ?? 0));
  if (command.deixis) {
    const el = focus.resolveDeixis(command.deixis, snapshot, byRole);
    return el
      ? { kind: "element", element: el, via: "deixis" }
      : { kind: "missing", reason: `nothing to resolve "${command.deixis}" against yet` };
  }
  const words = command.target ? normalizeName(command.target) : "";
  if (command.ordinal !== undefined) {
    // "the second invoice": whole-word matches first ("Invoice #1042", not the "Invoices" tab).
    const whole = byRole.filter((e) => wordHit(e, words));
    let set = words
      ? whole.length > 0
        ? whole
        : byRole.filter((e) => nameHit(e, words) || normalizeName(e.role) === words)
      : byRole;
    // "the second one" refers to the last-mentioned set when there is one.
    if (!words && !command.role) {
      const mentioned = focus.mentioned(snapshot);
      if (mentioned.length > 0) set = mentioned;
    }
    const el = command.ordinal < 0 ? set[set.length + command.ordinal] : set[command.ordinal - 1];
    return el
      ? { kind: "element", element: el, via: "ordinal" }
      : { kind: "missing", reason: `there is no item ${command.ordinal} (${set.length} match)` };
  }
  if (words) {
    const exact = byRole.filter((e) => normalizeName(e.name) === words);
    if (exact.length === 1 && exact[0]) return { kind: "element", element: exact[0], via: "name" };
    const partial = exact.length > 1 ? exact : byRole.filter((e) => nameHit(e, words));
    if (partial.length === 1 && partial[0]) return { kind: "element", element: partial[0], via: "name" };
    if (partial.length > 1) return { kind: "candidates", elements: partial };
    return { kind: "candidates", elements: byRole.length > 0 ? byRole : [...pool] };
  }
  if (command.role && byRole.length === 1 && byRole[0])
    return { kind: "element", element: byRole[0], via: "name" };
  return { kind: "candidates", elements: byRole.length > 0 ? byRole : [...pool] };
}

// ---------------------------------------------------------------------------------------------------------
// Actions

const VERB_EFFECT: Partial<Record<VoiceVerb, EffectClass>> = { submit: "commit" };

const SUBMIT_NAME =
  /^(submit|send|save|sign in|log in|login|continue|next|search|apply|confirm|ok|done|create|update)\b/i;
const NEXT_NAME = /^(next|next page|›|»|>|more results|older)$/i;
const PREVIOUS_NAME = /^(previous|prev|previous page|‹|«|<|newer)$/i;

/** Builds the element action for a verb; undefined when the verb needs an element it did not get. */
export function actionFor(
  command: VoiceCommand,
  element: Element | undefined,
  snapshot: Snapshot,
): Action | undefined {
  const token = element?.token;
  const n = Math.max(1, Number(command.value ?? "1") || 1);
  switch (command.verb) {
    case "click":
    case "open":
    case "next_page":
    case "previous_page":
      return token ? { type: "press", token } : undefined;
    case "submit":
      // No submit button found: Enter submits the focused form. Still a commit.
      return token ? { type: "press", token } : { type: "key", keys: ["Enter"] };
    case "hover":
      return token ? { type: "move", target: { token } } : undefined;
    case "focus":
      return token ? { type: "focus", token } : undefined;
    case "check":
      return token ? { type: "toggle", token, checked: true } : undefined;
    case "uncheck":
      return token ? { type: "toggle", token, checked: false } : undefined;
    case "select": {
      if (!token || !element) return undefined;
      if (command.value && element.actions.includes("select_option")) {
        const wanted = normalizeName(command.value);
        const option = element.options?.find((o) => normalizeName(o) === wanted) ?? command.value;
        return { type: "select_option", token, option };
      }
      return { type: "press", token };
    }
    case "type":
      if (command.value === undefined) return undefined;
      return token
        ? { type: "set_value", token, value: command.value }
        : { type: "type_text", text: command.value };
    case "fill":
      return token && command.value !== undefined
        ? { type: "set_value", token, value: command.value }
        : undefined;
    case "clear":
      return token ? { type: "set_value", token, value: "" } : undefined;
    case "press_key":
      return { type: "key", keys: [command.value ?? "Enter"] };
    case "scroll_up":
      return { type: "scroll", dx: 0, dy: -SCROLL_STEP_PX * n };
    case "scroll_down":
      return { type: "scroll", dx: 0, dy: SCROLL_STEP_PX * n };
    case "scroll_top":
      return { type: "key", keys: ["Home"] };
    case "scroll_bottom":
      return { type: "key", keys: ["End"] };
    case "page_up":
      return { type: "key", keys: ["PageUp"] };
    case "page_down":
      return { type: "key", keys: ["PageDown"] };
    case "back":
      return { type: "back" };
    case "navigate":
      return command.value ? { type: "navigate", url: withScheme(command.value) } : undefined;
    case "reload":
      return snapshot.url ? { type: "navigate", url: snapshot.url } : undefined;
    default:
      return undefined;
  }
}

const withScheme = (url: string): string => (/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);

/** Verbs that act without an element (or pick one by convention). */
const NO_TARGET: ReadonlySet<VoiceVerb> = new Set<VoiceVerb>([
  "press_key",
  "scroll_up",
  "scroll_down",
  "scroll_top",
  "scroll_bottom",
  "page_up",
  "page_down",
  "back",
  "navigate",
  "reload",
]);

const hasTargetWords = (c: VoiceCommand): boolean =>
  c.target !== undefined ||
  c.ordinal !== undefined ||
  c.badge !== undefined ||
  c.deixis !== undefined ||
  c.role !== undefined;

function finish(
  command: VoiceCommand,
  element: Element | undefined,
  snapshot: Snapshot,
  via: ResolvedVia,
): VoiceResolution {
  const action = actionFor(command, element, snapshot);
  if (!action) return { kind: "unresolved", command, reason: `cannot ${command.verb} without a target` };
  const effect = combineEffect(element, VERB_EFFECT[command.verb]);
  return {
    kind: "action",
    command,
    action,
    ...(element ? { element } : {}),
    effect,
    needsConfirmation: effect !== "advance",
    via,
  };
}

/** Default element for verbs spoken without a target ("submit", "clear", "next page", "type hello"). */
function conventionalTarget(
  command: VoiceCommand,
  candidates: CandidateTable,
  snapshot: Snapshot,
  focus: FocusStack,
) {
  const press = candidates.press;
  switch (command.verb) {
    case "submit":
      return (
        press.find((e) => (e.region === "dialog" || e.region === "form") && SUBMIT_NAME.test(e.name)) ??
        press.find((e) => SUBMIT_NAME.test(e.name))
      );
    case "next_page":
      return press.find((e) => NEXT_NAME.test(e.name.trim()));
    case "previous_page":
      return press.find((e) => PREVIOUS_NAME.test(e.name.trim()));
    case "clear":
    case "type": {
      const focused = snapshot.elements.find(
        (e) => e.states.includes("focused") && e.actions.includes("set_value"),
      );
      return focused ?? focus.resolveDeixis("it", snapshot);
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Jev

const asVerb = (s: string): VoiceVerb | undefined => {
  const parsed = VoiceVerbSchema.safeParse(s);
  return parsed.success ? parsed.data : undefined;
};

function rankedFromAnswer(answer: Answer | undefined, offered: readonly Element[]): Element[] {
  if (answer?.type !== "choice") return [];
  const byToken = new Map(offered.map((e) => [e.token, e]));
  return Object.entries(answer.probabilities)
    .filter(([k]) => k !== NONE && k !== AMBIGUOUS)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => byToken.get(k))
    .filter((e): e is Element => e !== undefined);
}

async function askJev(
  ctx: ResolveContext,
  utterance: string,
  candidates: CandidateTable,
  askIntent: boolean,
  operations: readonly Operation[],
): Promise<
  | {
      trace: VoiceDecisionTrace;
      answers?: Record<string, Answer>;
      offered: Partial<Record<Operation, Element[]>>;
    }
  | undefined
> {
  if (!ctx.decision) return undefined;
  const badges = new Map(ctx.focus.snapshot().badges.map(([n, id]) => [id, n]));
  const req = buildVoiceDecision({
    utterance,
    page: { title: ctx.snapshot.title, ...(ctx.snapshot.url ? { url: ctx.snapshot.url } : {}) },
    candidates,
    askIntent,
    operations,
    badges,
  });
  if (!req) return undefined;
  const r = await ctx.decision.ask(req.state, req.questions, ctx.signal ? { signal: ctx.signal } : {});
  if (!r.ok) return { trace: { questions: req.questions, error: r.error }, offered: req.offered };
  return {
    trace: { questions: req.questions, response: r.value },
    answers: r.value.answers,
    offered: req.offered,
  };
}

/** Picks the target from a Jev answer, or explains why it could not. */
function pickTarget(
  ctx: ResolveContext,
  command: VoiceCommand,
  op: Operation,
  answers: Record<string, Answer>,
  offered: readonly Element[],
): VoiceResolution {
  const t = ctx.thresholds ?? DEFAULT_THRESHOLDS;
  const answer = answers[voiceTargetHead(op)];
  const ranked = rankedFromAnswer(answer, offered);
  const choice = answer?.type === "choice" ? answer.choice : undefined;
  const el = offered.find((e) => e.token === choice);
  if (el && choiceConfidence(answer) >= t.target) {
    ctx.focus.recordChoice(el, ranked);
    return finish(command, el, ctx.snapshot, "jev");
  }
  const top = ranked.slice(0, 9);
  if (top.length >= 2 || (choice === AMBIGUOUS && top.length > 0))
    return {
      kind: "clarify",
      command,
      candidates: top,
      reason: choice === AMBIGUOUS ? "ambiguous" : "low confidence",
    };
  if (top.length === 1 && top[0])
    return { kind: "clarify", command, candidates: top, reason: "low confidence" };
  return { kind: "unresolved", command, reason: "no element matches" };
}

// ---------------------------------------------------------------------------------------------------------
// Entry points

/** Resolves an already parsed command against the snapshot. */
export async function resolveCommand(
  command: VoiceCommand,
  ctx: ResolveContext,
): Promise<{ resolution: VoiceResolution; decision?: VoiceDecisionTrace }> {
  if (CONTROL_VERBS.has(command.verb)) return { resolution: { kind: "control", command } };
  const { snapshot, focus } = ctx;
  if (NO_TARGET.has(command.verb) && !(command.verb === "press_key" && hasTargetWords(command)))
    return { resolution: finish(command, undefined, snapshot, "none") };

  const candidates = buildCandidates(snapshot);
  const op = VERB_OPERATION[command.verb] ?? "press";
  // Hover and focus may point at anything pressable or fillable.
  const pool =
    command.verb === "hover" || command.verb === "focus"
      ? [
          ...new Set([
            ...candidates.press,
            ...candidates.set_value,
            ...candidates.toggle,
            ...candidates.select_option,
          ]),
        ]
      : command.verb === "select" && candidates.select_option.length === 0
        ? candidates.press
        : candidates[op];

  if (!hasTargetWords(command)) {
    const conv = conventionalTarget(command, candidates, snapshot, focus);
    if (conv) return { resolution: finish(command, conv, snapshot, "focus") };
    if (command.verb === "type" && command.value !== undefined)
      return { resolution: finish(command, undefined, snapshot, "none") };
    if (command.verb === "submit") return { resolution: finish(command, undefined, snapshot, "none") };
  }

  const code = resolveTargetInCode(command, pool, snapshot, focus);
  if (code.kind === "element") return { resolution: finish(command, code.element, snapshot, code.via) };
  if (code.kind === "missing") return { resolution: { kind: "unresolved", command, reason: code.reason } };
  if (code.elements.length === 0)
    return { resolution: { kind: "unresolved", command, reason: "no element on the page fits" } };

  const narrowed: CandidateTable = emptyCandidates();
  const headOp: Operation = command.verb === "select" && candidates.select_option.length === 0 ? "press" : op;
  narrowed[headOp] = code.elements;
  const jev = await askJev(ctx, command.utterance, narrowed, false, [headOp]);
  if (!jev)
    return {
      resolution: {
        kind: "clarify",
        command,
        candidates: code.elements.slice(0, 9),
        reason: "no decision provider",
      },
    };
  if (!jev.answers)
    return {
      resolution: {
        kind: "unresolved",
        command,
        reason: `decision failed: ${jev.trace.error?.message ?? "unknown"}`,
      },
      decision: jev.trace,
    };
  return {
    resolution: pickTarget(ctx, command, headOp, jev.answers, jev.offered[headOp] ?? []),
    decision: jev.trace,
  };
}

/** Full pipeline for one final transcript. */
export async function resolveUtterance(text: string, ctx: ResolveContext): Promise<ResolveOutput> {
  const parse = parseUtterance(text);
  switch (parse.kind) {
    case "empty":
      return { parse, resolution: { kind: "unresolved", reason: "nothing was said" } };
    case "goal":
      return { parse, resolution: { kind: "goal", goal: parse.goal } };
    case "command": {
      const r = await resolveCommand(parse.command, ctx);
      return { parse, ...r };
    }
    case "unknown":
      return { parse, ...(await resolveUnknown(parse.utterance, text, ctx)) };
  }
}

/** Tier 2 for utterances the grammar did not parse: Jev intent + target in one request. */
async function resolveUnknown(
  utterance: string,
  raw: string,
  ctx: ResolveContext,
): Promise<{ resolution: VoiceResolution; decision?: VoiceDecisionTrace }> {
  const t = ctx.thresholds ?? DEFAULT_THRESHOLDS;
  const candidates = buildCandidates(ctx.snapshot);
  const ops = (Object.keys(candidates) as Operation[]).filter((op) => candidates[op].length > 0);
  const jev = await askJev(ctx, utterance, candidates, true, ops);
  if (!jev) return { resolution: { kind: "goal", goal: raw.trim() } };
  if (!jev.answers) return { resolution: { kind: "goal", goal: raw.trim() }, decision: jev.trace };
  const intent = jev.answers[INTENT_HEAD];
  const verb = intent?.type === "choice" ? asVerb(intent.choice) : undefined;
  if (!verb || choiceConfidence(intent) < t.intent)
    return { resolution: { kind: "goal", goal: raw.trim() }, decision: jev.trace };
  const command: VoiceCommand = { verb, correction: false, utterance, source: "jev" };
  if (CONTROL_VERBS.has(verb) || NO_TARGET.has(verb)) {
    // Jev cannot supply values (keys, URLs, amounts); those verbs only come from the grammar.
    if (verb === "navigate" || verb === "press_key")
      return { resolution: { kind: "goal", goal: raw.trim() }, decision: jev.trace };
    return {
      resolution: CONTROL_VERBS.has(verb)
        ? { kind: "control", command }
        : finish(command, undefined, ctx.snapshot, "jev"),
      decision: jev.trace,
    };
  }
  if (verb === "type" || verb === "fill")
    return { resolution: { kind: "goal", goal: raw.trim(), command }, decision: jev.trace };
  const op = VERB_OPERATION[verb] ?? "press";
  return {
    resolution: pickTarget(ctx, command, op, jev.answers, jev.offered[op] ?? []),
    decision: jev.trace,
  };
}
