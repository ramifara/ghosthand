// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Deterministic command grammar (tier 1, 0-5 ms): closed commands over a normalized transcript.
// Anything it cannot parse goes to the Jev intent step; multi-step requests go to the planner as a goal.
import type { Deixis, VoiceCommand, VoiceVerb } from "@ghosthand/protocol";
import { ORDINAL_PATTERN, parseCardinal, parseOrdinal } from "./numbers.ts";

export type ParseResult =
  | { kind: "command"; command: VoiceCommand }
  /** Multi-step or open-ended request: hand to the planner. */
  | { kind: "goal"; goal: string; utterance: string }
  /** Not a closed command: ask Jev for the intent. */
  | { kind: "unknown"; utterance: string }
  | { kind: "empty" };

// ---------------------------------------------------------------------------------------------------------
// Normalization

const LEADING_FILLERS =
  /^(?:(?:hey|ok|okay|so|um+|uh+|er|now|then|and|please|ghosthand|ghost hand|can you|could you|would you|will you|i want to|i'd like to|let's|lets|go ahead and)\s+)+/;
const FILLER_ONLY = /^(?:um+|uh+|er|hmm+|ok|okay|so|hey|please|and)$/;
const TRAILING_FILLERS = /(?:\s+(?:please|thanks|thank you|now|for me))+$/;

/** Lowercase, strip punctuation (keeping ' . @ / : - inside words), collapse whitespace, drop fillers. */
export function normalizeUtterance(text: string): string {
  let t = text
    .toLowerCase()
    .replace(/[“”"]/g, " ")
    .replace(/[,;!?]+/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\bdrop-down\b/g, "dropdown")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(LEADING_FILLERS, "").replace(TRAILING_FILLERS, "").trim();
  // STT models sometimes repeat a short phrase ("click 12 click 12"): keep one copy.
  t = t.replace(/^(.{3,}?)(?:\s+\1)+$/, "$1");
  // Past-tense mishearings of the opening verb ("opened the last result").
  t = t.replace(PAST_TENSE, (_m, verb: string) => PAST_TO_VERB[verb] ?? verb);
  return FILLER_ONLY.test(t) ? "" : t;
}

const PAST_TO_VERB: Readonly<Record<string, string>> = {
  opened: "open",
  clicked: "click",
  scrolled: "scroll",
  selected: "select",
  checked: "check",
  unchecked: "uncheck",
  typed: "type",
  pressed: "press",
  submitted: "submit",
  reloaded: "reload",
};
const PAST_TENSE = new RegExp(`^(${Object.keys(PAST_TO_VERB).join("|")})\\b`);

// ---------------------------------------------------------------------------------------------------------
// Targets

/** Spoken role nouns → ARIA-ish role names. */
const ROLE_NOUNS: Readonly<Record<string, string>> = {
  button: "button",
  buttons: "button",
  link: "link",
  links: "link",
  field: "textbox",
  box: "textbox",
  input: "textbox",
  textbox: "textbox",
  "text box": "textbox",
  "text field": "textbox",
  "search box": "searchbox",
  checkbox: "checkbox",
  "check box": "checkbox",
  tab: "tab",
  option: "option",
  "menu item": "menuitem",
  menu: "menu",
  dropdown: "combobox",
  "drop down": "combobox",
  heading: "heading",
  image: "image",
  picture: "image",
  row: "row",
  item: "listitem",
  result: "listitem",
  switch: "switch",
  radio: "radio",
  "radio button": "radio",
};
const ROLE_NOUN_PATTERN = Object.keys(ROLE_NOUNS)
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/ /g, "\\s"))
  .join("|");

const DEIXIS_PHRASES: ReadonlyArray<readonly [RegExp, Deixis]> = [
  [/^(?:the\s+)?other(?:\s+one)?$/, "other"],
  [/^(?:the\s+)?(?:next|following)(?:\s+one)?$|^(?:the\s+)?one\s+(?:below|after(?:\s+that)?)$/, "next"],
  [/^(?:the\s+)?previous(?:\s+one)?$|^(?:the\s+)?one\s+(?:above|before(?:\s+that)?)$/, "previous"],
  [/^this(?:\s+one)?$|^this\s+(?:here)$|^here$/, "this"],
  [/^that(?:\s+one)?$|^that\s+there$|^there$/, "that"],
  [/^it$/, "it"],
];

export interface TargetPhrase {
  target?: string;
  role?: string;
  ordinal?: number;
  badge?: number;
  deixis?: Deixis;
}

const ORDINAL_HEAD = new RegExp(`^(?:the\\s+)?(${ORDINAL_PATTERN})(?:\\s+(.*))?$`);
const ROLE_TAIL = new RegExp(`^(.*?)\\s*\\b(${ROLE_NOUN_PATTERN})$`);
const ROLE_ONLY = new RegExp(`^(?:${ROLE_NOUN_PATTERN})$`);

const stripArticles = (s: string): string =>
  s
    .replace(/^(?:on|at|to)\s+/, "")
    .replace(/^(?:the|a|an|my)\s+/, "")
    .trim();

/** Parses a spoken target: badge number, deixis, ordinal + role/noun, or a name with an optional role. */
export function parseTarget(phrase: string): TargetPhrase {
  const p = stripArticles(phrase.trim());
  if (p.length === 0) return {};
  const num = /^(?:number|item|#)\s*(.+)$/.exec(p);
  const badge = parseCardinal(num?.[1] ?? p, num !== null);
  if (badge !== undefined && badge > 0) return { badge };
  for (const [re, deixis] of DEIXIS_PHRASES) if (re.test(p)) return { deixis };
  // "this button", "that link"
  const deicticRole = new RegExp(`^(this|that)\\s+(${ROLE_NOUN_PATTERN})$`).exec(p);
  if (deicticRole?.[1] && deicticRole[2])
    return { deixis: deicticRole[1] as Deixis, role: ROLE_NOUNS[deicticRole[2].replace(/\s+/g, " ")] ?? "" };
  const ord = ORDINAL_HEAD.exec(p);
  if (ord?.[1]) {
    const ordinal = parseOrdinal(ord[1]);
    if (ordinal !== undefined) {
      const rest = stripArticles(ord[2] ?? "").replace(/^one$/, "");
      if (!rest) return { ordinal };
      const sub = withRole(rest);
      return { ordinal, ...sub };
    }
  }
  return withRole(p);
}

function withRole(p: string): TargetPhrase {
  if (ROLE_ONLY.test(p)) return { role: ROLE_NOUNS[p.replace(/\s+/g, " ")] ?? p };
  const m = ROLE_TAIL.exec(p);
  if (m?.[1] && m[2]) {
    const name = stripArticles(m[1]);
    const role = ROLE_NOUNS[m[2].replace(/\s+/g, " ")];
    if (name && role) return { target: name, role };
  }
  return { target: p };
}

// ---------------------------------------------------------------------------------------------------------
// Rules

type Fields = Omit<VoiceCommand, "verb" | "correction" | "utterance" | "source">;
type Rule = { re: RegExp; verb: VoiceVerb; build?: (m: RegExpExecArray) => Fields | undefined };

const KEY_NAMES: Readonly<Record<string, string>> = {
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  "shift tab": "Shift+Tab",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  "space bar": "Space",
  spacebar: "Space",
  backspace: "Backspace",
  "back space": "Backspace",
  delete: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  "up arrow": "ArrowUp",
  "down arrow": "ArrowDown",
  "left arrow": "ArrowLeft",
  "right arrow": "ArrowRight",
  "arrow up": "ArrowUp",
  "arrow down": "ArrowDown",
  "arrow left": "ArrowLeft",
  "arrow right": "ArrowRight",
  home: "Home",
  end: "End",
  "page up": "PageUp",
  "page down": "PageDown",
};
const KEY_PATTERN = Object.keys(KEY_NAMES)
  .sort((a, b) => b.length - a.length)
  .join("|");

const target = (phrase: string | undefined): Fields => (phrase ? parseTarget(phrase) : {});

/** "N times", "a bit", "a lot" → a scroll count; undefined when the words are not an amount. */
function scrollAmount(s: string | undefined): Fields | undefined {
  if (!s) return {};
  const t = s.replace(/\s+times?$/, "").trim();
  if (/^(?:a\s+)?(?:bit|little(?:\s+bit)?)$/.test(t)) return { value: "1" };
  if (/^(?:a\s+lot|lots|way)$/.test(t)) return { value: "5" };
  if (/^more$/.test(t)) return {};
  const n = parseCardinal(t, true);
  return n !== undefined ? { value: String(n) } : undefined;
}

/** Spoken URL fixes: "example dot com slash pricing" → "example.com/pricing". */
export function spokenUrl(s: string): string {
  return s
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+slash\s+/g, "/")
    .replace(/\s+colon\s+/g, ":")
    .replace(/\s+/g, "");
}

const looksLikeUrl = (s: string): boolean =>
  /^(?:https?:\/\/|localhost\b|\d{1,3}(?:\.\d{1,3}){3})/.test(s) ||
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app|ai|co|uk|de|fr|edu|gov|me|info|xyz|test)(?:[/:].*)?$/.test(
    s,
  );

const RULES: Rule[] = [
  // control
  { re: /^(?:stop|halt|abort|freeze|stop it|stop now|stop that|hold it)$/, verb: "stop" },
  { re: /^(?:cancel|cancel that|never ?mind|forget it|forget that)$/, verb: "cancel" },
  { re: /^(?:undo|undo that|undo it|revert|revert that|take that back)$/, verb: "undo" },
  {
    re: /^(?:wait|hold on|pause|one (?:moment|sec(?:ond)?)|just a (?:moment|sec(?:ond)?)|wait a (?:moment|sec(?:ond)?))$/,
    verb: "wait",
  },
  { re: /^(?:continue|go on|keep going|resume|carry on|proceed|next step)$/, verb: "continue" },
  {
    re: /^(?:yes|yeah|yep|yup|confirm|confirmed|yes do it|yes please|do it|go ahead|ok do it|okay do it|sure|that's right|correct|affirmative)$/,
    verb: "confirm",
  },
  { re: /^(?:no|nope|nah|don't|do not|don't do it|negative)$/, verb: "deny" },
  { re: /^(?:repeat|repeat that|again|do (?:it|that) again|once more|one more time)$/, verb: "repeat" },
  { re: /^(?:help|what can i say|show (?:me )?(?:the )?commands|list commands)$/, verb: "help" },
  // meta
  { re: /^(?:start|begin) recording$|^record(?: this)?$/, verb: "start_recording" },
  { re: /^(?:stop|end|finish) recording$/, verb: "stop_recording" },
  {
    re: /^save (?:this |that |it )?(?:as )?(?:a )?(?:new )?recipe(?:\s+(?:called|named|as))?(?:\s+(.+))?$/,
    verb: "save_recipe",
    build: (m) => (m[1] ? { value: m[1] } : {}),
  },
  // overlays
  {
    re: /^(?:show|display) (?:the )?(?:numbers|labels|hints|badges)(?: here)?$|^number (?:everything|them)$/,
    verb: "show_numbers",
  },
  { re: /^(?:hide|clear|remove) (?:the )?(?:numbers|labels|hints|badges)$/, verb: "hide_numbers" },
  { re: /^(?:show|display) (?:the )?grid$/, verb: "show_grid" },
  // navigation
  { re: /^(?:go |navigate |browser )?back(?: a page| one page)?$/, verb: "back" },
  { re: /^(?:go |navigate |browser )?forward$/, verb: "forward" },
  { re: /^(?:reload|refresh)(?: (?:the |this )?page)?$/, verb: "reload" },
  { re: /^(?:open |create )?(?:a )?new tab$/, verb: "new_tab" },
  { re: /^close (?:the |this )?(?:current )?tab$/, verb: "close_tab" },
  { re: /^(?:go to (?:the )?)?next page$/, verb: "next_page" },
  { re: /^(?:go to (?:the )?)?(?:previous|prev|last) page$/, verb: "previous_page" },
  // scrolling
  {
    re: /^scroll (?:all the way )?(?:to the )?top$|^(?:go|jump) to (?:the )?top(?: of the page)?$/,
    verb: "scroll_top",
  },
  {
    re: /^scroll (?:all the way )?(?:to the )?bottom$|^(?:go|jump) to (?:the )?(?:bottom|end)(?: of the page)?$/,
    verb: "scroll_bottom",
  },
  { re: /^scroll up(?:\s+(.+))?$|^up(?: a bit)?$/, verb: "scroll_up", build: (m) => scrollAmount(m[1]) },
  {
    re: /^scroll(?: down)?(?:\s+(.+))?$|^down(?: a bit)?$/,
    verb: "scroll_down",
    build: (m) => scrollAmount(m[1]),
  },
  { re: /^page up$/, verb: "page_up" },
  { re: /^page down$/, verb: "page_down" },
  // keys
  {
    re: new RegExp(`^(?:press|hit|push|type)(?: the)? (${KEY_PATTERN})(?: key)?$`),
    verb: "press_key",
    build: (m) => ({ value: KEY_NAMES[m[1] ?? ""] ?? "Enter" }),
  },
  // text
  { re: /^(?:submit|send)(?: (?:it|this|the form|form))?$/, verb: "submit" },
  {
    re: /^(?:clear|empty|erase)(?:\s+(.+?))?$/,
    verb: "clear",
    build: (m) => target(m[1]),
  },
  {
    re: /^fill(?: in| out)?\s+(.+?)\s+with\s+(.+)$/,
    verb: "fill",
    build: (m) => ({ ...target(m[1]), value: m[2] ?? "" }),
  },
  {
    re: /^(?:set|change)\s+(.+?)\s+to\s+(.+)$/,
    verb: "fill",
    build: (m) => ({ ...target(m[1]), value: m[2] ?? "" }),
  },
  {
    re: /^(?:enter|put|write)\s+(.+?)\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box|input))?$/,
    verb: "fill",
    build: (m) => ({ ...target(m[2]), value: m[1] ?? "" }),
  },
  {
    re: /^type\s+(.+?)\s+(?:into\s+(?:the\s+)?(.+?)|in\s+the\s+(.+?\s+(?:field|box|input|area)))$/,
    verb: "type",
    build: (m) => ({ ...target(m[2] ?? m[3]), value: m[1] ?? "" }),
  },
  { re: /^(?:type|dictate|write)\s+(.+)$/, verb: "type", build: (m) => ({ value: m[1] ?? "" }) },
  // pointing
  {
    re: /^(?:go to|navigate to|open|visit|browse to)\s+(.+)$/,
    verb: "navigate",
    build: (m) => {
      const url = spokenUrl(m[1] ?? "");
      return looksLikeUrl(url) ? { value: url } : undefined;
    },
  },
  { re: /^(?:go to|navigate to|take me to|switch to)\s+(.+)$/, verb: "open", build: (m) => target(m[1]) },
  {
    re: /^select\s+(.+?)\s+(?:from|in)\s+(?:the\s+)?(.+)$/,
    verb: "select",
    build: (m) => ({ ...target(m[2]), value: m[1] ?? "" }),
  },
  { re: /^(?:select|choose|pick)\s+(.+)$/, verb: "select", build: (m) => target(m[1]) },
  { re: /^(?:check|tick|enable)\s+(.+)$/, verb: "check", build: (m) => target(m[1]) },
  { re: /^(?:uncheck|untick|un check|disable)\s+(.+)$/, verb: "uncheck", build: (m) => target(m[1]) },
  { re: /^focus(?:\s+on)?\s+(.+)$/, verb: "focus", build: (m) => target(m[1]) },
  { re: /^(?:hover|mouse)(?:\s+over|\s+on)?\s+(.+)$/, verb: "hover", build: (m) => target(m[1]) },
  { re: /^(?:open|expand|show(?: me)?)\s+(.+)$/, verb: "open", build: (m) => target(m[1]) },
  {
    re: /^(?:click|tap|press|hit|push|double click|click on|tap on)\s+(.+)$/,
    verb: "click",
    build: (m) => target(m[1]),
  },
];

const CORRECTION = /^(?:no|nope|not that(?: one)?|wrong(?: one)?|actually|i meant|i said|sorry)\s+(.+)$/;
const CORRECTION_ALONE = /^(?:not that(?: one)?|wrong(?: one)?|not this one)$/;

/** Words that start an open-ended goal for the planner rather than a single command. */
const GOAL_VERBS =
  /^(?:find|search(?: for)?|look for|look up|book|buy|order|purchase|create|add|log ?in|sign ?in|log ?out|sign ?out|sign up|register|download|upload|compose|reply|send (?:an? )?(?:email|message)|write (?:an? )?(?:email|message|post)|delete|remove|archive|fill (?:in |out )?(?:the |this )?form|complete|change my|update my|go through|compare|export|filter|sort|summari[sz]e|make|schedule|invite|share|pay)\b/;
/** "fill the form with my test data" is a goal, unlike "fill name with Rami". */
const FORM_GOAL = /^fill (?:in |out )?(?:the |this |my )?(?:whole |entire )?form\b/;
const MULTI_STEP = /\b(?:and then|then|after that|afterwards|and also|once that's done|followed by)\b/;

const command = (verb: VoiceVerb, fields: Fields, utterance: string, correction: boolean): ParseResult => ({
  kind: "command",
  command: { verb, ...fields, correction, utterance, source: "grammar" },
});

function matchRules(t: string): { verb: VoiceVerb; fields: Fields } | undefined {
  for (const rule of RULES) {
    const m = rule.re.exec(t);
    if (!m) continue;
    const fields = rule.build ? rule.build(m) : {};
    if (fields === undefined) continue;
    return { verb: rule.verb, fields };
  }
  return undefined;
}

/** True for requests that need several steps ("open settings and then change the email"). */
export function isMultiStep(t: string): boolean {
  if (MULTI_STEP.test(t)) return true;
  // "<verb> X and <verb> Y"
  const parts = t.split(/\s+and\s+/);
  return parts.length > 1 && parts.slice(1).some((p) => matchRules(p) !== undefined || GOAL_VERBS.test(p));
}

/** Parses one utterance. Pure and fast; safe to run on every final transcript. */
export function parseUtterance(raw: string): ParseResult {
  const utterance = normalizeUtterance(raw);
  if (!utterance) return { kind: "empty" };
  if (isMultiStep(utterance) || FORM_GOAL.test(utterance))
    return { kind: "goal", goal: raw.trim(), utterance };

  let t = utterance;
  let correction = false;
  if (CORRECTION_ALONE.test(t)) return command("correct", { deixis: "other" }, utterance, true);
  const corr = CORRECTION.exec(t);
  if (corr?.[1] && !/^(?:thanks|thank you)$/.test(corr[1])) {
    correction = true;
    t = corr[1];
  }

  const ruled = matchRules(t);
  if (ruled) return command(ruled.verb, ruled.fields, utterance, correction);

  // Bare target: "12", "number five", "the second one", "the other one", "that one".
  const bare = parseTarget(t);
  if (bare.badge !== undefined) return command(correction ? "correct" : "click", bare, utterance, correction);
  if (bare.deixis !== undefined || bare.ordinal !== undefined) {
    const verb: VoiceVerb = correction || bare.deixis === "other" ? "correct" : "click";
    return command(verb, bare, utterance, correction || bare.deixis === "other");
  }
  if (correction && bare.target) return command("correct", bare, utterance, true);

  if (GOAL_VERBS.test(t) || t.split(" ").length > 12) return { kind: "goal", goal: raw.trim(), utterance };
  return { kind: "unknown", utterance };
}

/** One-line rendering for the intent chip and the run log: `click → "settings" (button, #2)`. */
export function describeCommand(c: VoiceCommand): string {
  const parts: string[] = [c.correction ? `${c.verb} (correction)` : c.verb];
  const where: string[] = [];
  if (c.target) where.push(JSON.stringify(c.target));
  if (c.role) where.push(c.role);
  if (c.ordinal !== undefined)
    where.push(c.ordinal < 0 ? `last${c.ordinal === -1 ? "" : ` ${c.ordinal}`}` : `#${c.ordinal}`);
  if (c.badge !== undefined) where.push(`badge ${c.badge}`);
  if (c.deixis) where.push(c.deixis);
  if (where.length > 0) parts.push(`→ ${where.join(" ")}`);
  if (c.value !== undefined) parts.push(`= ${JSON.stringify(c.value)}`);
  return parts.join(" ");
}
