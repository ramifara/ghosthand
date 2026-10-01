// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Code rules for consequences: risk phrases in element names (destructive or external effects) and the
// task's forbidden phrases, matched by simple token overlap. Drivers call `riskFromName`; the loop calls
// `matchForbidden` before acting. No model judgement here; the stricter of code and model wins in gates.
import type { Element, ElementRisk } from "@ghosthand/protocol";

/** Irreversible or security-relevant changes. A bare "Cancel" (closing a dialog) is not one of them. */
const DESTRUCTIVE =
  /\b(delete|remove|destroy|erase|discard|wipe|purge|terminate|deactivate|revoke|rotate|unsubscribe|close (my |your |the |this )?account|cancel (my |your |the |this )?(subscription|plan|membership|order|booking|reservation|payment|transfer|account)|(change|reset) (my |your |the )?password|disable (two-factor|2fa|mfa))\b/i;

/** Effects that leave the app or reach other people: payments, messages, publishing, data export. */
const EXTERNAL =
  /\b(pay|pay now|purchase|buy|buy now|place (my |your |the |this )?order|checkout|check out|send|publish|transfer|post|share|donate|subscribe|export|invite)\b/i;

/** Risk implied by an element's name alone, or undefined when the name says nothing. */
export function riskFromName(name: string): Extract<ElementRisk, "destructive" | "external"> | undefined {
  if (DESTRUCTIVE.test(name)) return "destructive";
  if (EXTERNAL.test(name)) return "external";
  return undefined;
}

const STOPWORDS = new Set(
  (
    "a an the any all other another every each of or and to my your their its his her this that these those " +
    "than anything something some more with for on in at as not is be it from by into onto someone else " +
    "existing new own one"
  ).split(" "),
);

/** Verbs that name an action in forbidden phrases; everything else is an object. */
const VERBS = new Set(
  (
    "add archive buy cancel change check close create delete deactivate disable download edit enable " +
    "erase export format invite leave log open pay place post publish purchase remove rename reset " +
    "revoke rotate send share sign submit transfer undo unsubscribe update upload visit bulk"
  ).split(" "),
);

/** Lowercase word stems: plurals and common suffixes removed, so "orders" matches "order". */
export function stemTokens(text: string): string[] {
  return words(text).map(stem);
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['\u2019]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);

function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("es") && /(ss|sh|ch|x|us)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

export interface ForbiddenRule {
  phrase: string;
  /** Stemmed verbs; one must name the action. */
  verbs: string[];
  /** Stemmed objects that must appear in the target's name or context (none: the verb alone matches). */
  objects: string[];
  /** "any" for alternatives ("the email, handle or bio"), else every object must appear. */
  objectMatch: "any" | "all";
}

/** Splits a forbidden phrase ("delete any other order") into key verbs and objects. */
export function parseForbidden(phrase: string): ForbiddenRule | undefined {
  const content = words(phrase).filter((w) => !STOPWORDS.has(w));
  if (content.length === 0) return undefined;
  const verbs = content.filter((w) => VERBS.has(w));
  const verbWords = verbs.length > 0 ? verbs : [content[0] ?? ""];
  const objects = content.filter((w) => !verbWords.includes(w));
  return {
    phrase,
    verbs: [...new Set(verbWords.map(stem))],
    objects: [...new Set(objects.map(stem))],
    objectMatch: /,|\bor\b/i.test(phrase) ? "any" : "all",
  };
}

/**
 * Rules the code enforces for a task. A phrase whose verb and object the instruction itself asks for
 * ("Delete the order …" vs "delete any other order") is about scope, which only the model can judge, so
 * the code leaves it to the effect question.
 */
export function forbiddenRules(forbidden: readonly string[], instruction: string): ForbiddenRule[] {
  const asked = new Set(stemTokens(instruction));
  return forbidden
    .map(parseForbidden)
    .filter((r): r is ForbiddenRule => r !== undefined)
    .filter((r) => {
      const verbAsked = r.verbs.some((v) => asked.has(v));
      const objectAsked = r.objects.length === 0 || r.objects.some((o) => asked.has(o));
      return !(verbAsked && objectAsked);
    });
}

/**
 * The forbidden phrase acting on `element` matches, if any: a key verb in the element's name and the
 * phrase's object(s) in its name or context (its row, card or form). Only the name names the action, so
 * page text around a harmless button never turns it into a forbidden one.
 */
export function matchForbidden(
  element: Pick<Element, "name" | "context">,
  rules: readonly ForbiddenRule[],
): string | undefined {
  const name = stemTokens(element.name);
  const verbs = new Set(name);
  const objects = new Set([...name, ...stemTokens(element.context ?? "")]);
  for (const r of rules) {
    if (!r.verbs.some((v) => verbs.has(v))) continue;
    const hit =
      r.objects.length === 0 ||
      (r.objectMatch === "any"
        ? r.objects.some((o) => objects.has(o))
        : r.objects.every((o) => objects.has(o)));
    if (hit) return r.phrase;
  }
  return undefined;
}
