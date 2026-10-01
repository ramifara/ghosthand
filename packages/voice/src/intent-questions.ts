// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Tier 2 (Jev typed decisions): one request with an `intent` choice over the closed verb set (+ none),
// and one target head per operation over the current element table. Ordinals, badges and deixis are
// resolved in code first; Jev only sees what code could not settle.
import {
  AMBIGUOUS,
  ANTI_INJECTION,
  type CandidateTable,
  describeElement,
  NONE,
  type Operation,
} from "@ghosthand/core";
import {
  type ChoiceQuestion,
  type Element,
  type Entry,
  MAX_CHOICE_OPTIONS,
  type Questions,
  VOICE_VERBS,
  type VoiceVerb,
} from "@ghosthand/protocol";

export const INTENT_HEAD = "intent";
export const voiceTargetHead = (op: Operation): string => `${op}_target`;

/** Plain descriptions of each verb for the intent choice. */
export const VERB_TEXT: Readonly<Record<VoiceVerb, string>> = {
  back: "Go back to the previous page in browser history.",
  forward: "Go forward in browser history.",
  reload: "Reload the current page.",
  navigate: "Open a web address (URL or domain) typed or spoken by the user.",
  new_tab: "Open a new browser tab.",
  close_tab: "Close the current browser tab.",
  next_page: "Go to the next page of results (pagination).",
  previous_page: "Go to the previous page of results (pagination).",
  click: "Click or press a specific element on the page (button, link, row, tab, menu item).",
  open: "Open or expand a named section, menu, item or page inside the app.",
  select: "Choose an option in a dropdown, list or menu.",
  check: "Check, tick or turn on a checkbox, radio button or switch.",
  uncheck: "Uncheck, untick or turn off a checkbox or switch.",
  focus: "Move keyboard focus to an element without activating it.",
  hover: "Move the mouse over an element to reveal a tooltip or menu.",
  show_numbers: "Show number badges on clickable elements.",
  hide_numbers: "Hide the number badges.",
  show_grid: "Show a numbered grid over the screen for pointing.",
  type: "Type dictated text at the cursor or into a field.",
  fill: "Fill a named form field with a given value.",
  clear: "Clear the text in a field.",
  submit: "Submit or send the current form.",
  press_key: "Press a keyboard key such as Enter, Tab or Escape.",
  scroll_up: "Scroll the page up.",
  scroll_down: "Scroll the page down.",
  scroll_top: "Scroll to the top of the page.",
  scroll_bottom: "Scroll to the bottom of the page.",
  page_up: "Scroll up by one screen.",
  page_down: "Scroll down by one screen.",
  stop: "Stop what the agent is doing right now.",
  cancel: "Cancel the pending command or confirmation.",
  undo: "Undo the last action.",
  wait: "Pause and wait.",
  continue: "Continue or resume what was paused.",
  confirm: "Say yes to the pending confirmation.",
  deny: "Say no to the pending confirmation.",
  repeat: "Repeat the last command.",
  correct: "Correct the last command: the user meant a different element.",
  start_recording: "Start recording the session.",
  stop_recording: "Stop recording the session.",
  save_recipe: "Save the session as a reusable recipe.",
  help: "Show the list of voice commands.",
};

/** Verb → the element operation whose candidates it targets; undefined for verbs without a target. */
export const VERB_OPERATION: Readonly<Partial<Record<VoiceVerb, Operation>>> = {
  click: "press",
  open: "press",
  hover: "press",
  focus: "press",
  next_page: "press",
  previous_page: "press",
  submit: "press",
  select: "select_option",
  check: "toggle",
  uncheck: "toggle",
  type: "set_value",
  fill: "set_value",
  clear: "set_value",
};

export interface VoiceDecisionInput {
  utterance: string;
  page: { title: string; url?: string };
  candidates: CandidateTable;
  /** Ask the intent question (false when the grammar already fixed the verb). */
  askIntent: boolean;
  /** Operations whose target heads to include. */
  operations: readonly Operation[];
  /** Badge numbers currently shown, by stableId, to add as a column. */
  badges?: ReadonlyMap<string, number>;
}

export interface VoiceDecisionRequest {
  state: Entry;
  questions: Questions;
  /** Elements offered per head, in option order. */
  offered: Partial<Record<Operation, Element[]>>;
}

const withSuffix = (text: string): string => `${text} ${ANTI_INJECTION}`;

export function buildIntentQuestion(): ChoiceQuestion {
  const criteria: ChoiceQuestion["criteria"] = {};
  for (const verb of VOICE_VERBS) criteria[verb] = VERB_TEXT[verb];
  criteria[NONE] =
    "None of these single commands: the user asks for a multi-step task or something open-ended.";
  return {
    type: "choice",
    instructions: withSuffix(
      "The user spoke `utterance` to control the web page described in `page`. Which single command did they mean?",
    ),
    criteria,
  };
}

/** Option text for a candidate: core describeElement plus position columns that help with ordinals. */
export function describeVoiceCandidate(el: Element, index: number, sameRole: number, badge?: number): string {
  const cols = [describeElement(el), `${el.role} #${sameRole}`, `region ${el.region}`];
  if (badge !== undefined) cols.push(`badge ${badge}`);
  if (index === 0) cols.push("first listed");
  return cols.join(" · ");
}

const TARGET_TEXT: Record<Operation, string> = {
  press: "Which element did the user point at in `utterance` (to click, open, hover or focus)?",
  set_value: "Which input field did the user mean in `utterance`?",
  toggle: "Which checkbox, radio button or switch did the user mean in `utterance`?",
  select_option: "Which dropdown or list did the user mean in `utterance`?",
  select_text: "In which text field or editor did the user mean to select text in `utterance`?",
};

export function buildTargetQuestion(
  op: Operation,
  elements: readonly Element[],
  badges?: ReadonlyMap<string, number>,
): { question: ChoiceQuestion; offered: Element[] } | undefined {
  const offered = elements.slice(0, MAX_CHOICE_OPTIONS - 2);
  if (offered.length === 0) return undefined;
  const roleCount = new Map<string, number>();
  const criteria: ChoiceQuestion["criteria"] = {};
  offered.forEach((el, i) => {
    const n = (roleCount.get(el.role) ?? 0) + 1;
    roleCount.set(el.role, n);
    criteria[el.token] = describeVoiceCandidate(el, i, n, badges?.get(el.stableId));
  });
  criteria[NONE] = "None of the listed elements is what the user meant.";
  criteria[AMBIGUOUS] = "Several listed elements fit the utterance equally well.";
  return {
    question: {
      type: "choice",
      instructions: withSuffix(
        `${TARGET_TEXT[op]} Choose by the element's role, name, context and position.`,
      ),
      criteria,
    },
    offered,
  };
}

export function buildVoiceDecision(input: VoiceDecisionInput): VoiceDecisionRequest | undefined {
  const questions: Questions = {};
  const offered: Partial<Record<Operation, Element[]>> = {};
  if (input.askIntent) questions[INTENT_HEAD] = buildIntentQuestion();
  for (const op of input.operations) {
    const t = buildTargetQuestion(op, input.candidates[op], input.badges);
    if (!t) continue;
    questions[voiceTargetHead(op)] = t.question;
    offered[op] = t.offered;
  }
  if (Object.keys(questions).length === 0) return undefined;
  const state: Entry = {
    utterance: input.utterance,
    page: { title: input.page.title, ...(input.page.url ? { url: input.page.url } : {}) },
  };
  return { state, questions, offered };
}
