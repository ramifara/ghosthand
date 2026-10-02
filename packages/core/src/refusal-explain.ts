// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Plain-language reasons for a refused step: what Jev wanted to do, why the code did not let it, and
// what would unblock it. They end up in the run's stuck reason, so a person can act on them.
import type { Answer, EffectClass, Element, Snapshot } from "@ghosthand/protocol";
import { choiceConfidence, type GateResult } from "./gates.ts";

export interface RefusalFacts {
  operation: string;
  element?: Element;
  /** The answer for the operation's target head. */
  target?: Answer;
  opAnswer?: Answer;
  failed: GateResult[];
  effect: EffectClass;
  forbiddenHit?: string;
  snapshot: Snapshot;
  /** Id of the writer the loop can hand off to; undefined when there is none. */
  writer?: string;
  /** Jev's answer for the text head, and what each text option types (`lit_1` → `"vegan food"`). */
  text?: Answer;
  textLabels?: Record<string, string>;
}

/** Shown when free text is needed and no model can supply it. */
export const NO_WRITER_FIX =
  "no writer model is set up to supply it (add a model provider key or sign in with ChatGPT in Setup, or put the exact text in quotes in the goal)";

const pct = (p: number): string => `${Math.round(p * 100)}%`;

function label(e: Element): string {
  const name = e.name.trim();
  return name ? `${e.role} "${name.slice(0, 60)}"` : `an unnamed ${e.role}`;
}

/** The two most likely choices of an answer, named by their element when they are tokens. */
function topChoices(a: Answer | undefined, snapshot: Snapshot): string[] {
  // Elements read as `button "Accept all" (60%)`, operations as `press 59%`.
  if (a?.type !== "choice") return [];
  return Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .filter(([, p]) => p >= 0.05)
    .map(([token, p]) => {
      const e = snapshot.elements.find((x) => x.token === token);
      return e ? `${label(e)} (${pct(p)})` : `${token} ${pct(p)}`;
    });
}

const VERB: Record<string, string> = {
  press: "press",
  toggle: "toggle",
  set_value: "type into",
  select_text: "select text in",
  select_option: "pick an option in",
  drag: "drag",
  context_menu: "open the context menu of",
  scroll: "scroll",
};

export function explainRefusal(f: RefusalFacts): string {
  const verb = VERB[f.operation] ?? f.operation;
  const failed = new Set(f.failed.map((g) => g.gate));
  const effectGate = f.failed.find((g) => g.gate === "effect_allowed");
  if (effectGate && f.element) {
    if (f.forbiddenHit)
      return `Jev wanted to ${verb} ${label(f.element)}, which matches the forbidden phrase "${f.forbiddenHit}"`;
    return f.effect === "commit"
      ? `Jev wanted to ${verb} ${label(f.element)}, which commits a change this step may not make without approval`
      : `Jev wanted to ${verb} ${label(f.element)}, an effect this step does not allow (${effectGate.detail ?? f.effect})`;
  }
  const noOption = f.failed.find((g) => g.gate === "target_named" && /^no .* chosen$/.test(g.detail ?? ""));
  if (noOption && f.element) {
    if (f.operation === "set_value" && f.text?.type === "choice") {
      const top = Object.entries(f.text.probabilities)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 2)
        .map(([k, p]) => `${k === "none" ? "none" : (f.textLabels?.[k] ?? k)} ${pct(p)}`);
      const writer = f.writer ? `and the writer model (${f.writer}) did not settle it` : NO_WRITER_FIX;
      return `Jev wanted to type into ${label(f.element)} but was not sure which text from the goal belongs there (${top.join(" vs ")}), ${writer}`;
    }
    if (f.operation === "set_value") {
      const writer = f.writer ? `the writer model (${f.writer}) did not supply any either` : NO_WRITER_FIX;
      return `Jev wanted to type into ${label(f.element)} but the goal does not contain the text to type, and ${writer}`;
    }
    if (f.operation === "select_option")
      return `Jev wanted to pick an option in ${label(f.element)} but none of its options matches the goal`;
    if (f.operation === "drag")
      return `Jev wanted to drag ${label(f.element)} but found no place to drop it with enough confidence`;
  }
  if (failed.has("operation_confidence")) {
    const ops = topChoices(f.opAnswer, f.snapshot);
    return `Jev was unsure what to do next${ops.length ? ` (${ops.join(" or ")})` : ""}`;
  }
  if (!f.element) {
    const none = f.target?.type === "choice" && f.target.choice === "none";
    const top = topChoices(f.target, f.snapshot);
    return none
      ? `Jev found nothing on this page to ${verb} for the goal`
      : `Jev could not pick what to ${verb}${top.length ? `: ${top.join(" or ")}` : ""}`;
  }
  if (failed.has("target_confidence")) {
    const top = topChoices(f.target, f.snapshot);
    return top.length > 1
      ? `Jev could not decide what to ${verb}: ${top.join(" or ")}`
      : `Jev was not confident enough to ${verb} ${label(f.element)} (${pct(choiceConfidence(f.target))})`;
  }
  if (failed.has("target_named"))
    return `Jev chose ${label(f.element)}, which has no accessible name, so the action could not be checked`;
  if (failed.has("snapshot_fresh")) return "the page changed while Jev was deciding";
  return `Jev wanted to ${verb} ${label(f.element)} but the checks refused it (${f.failed.map((g) => g.gate).join(", ")})`;
}
