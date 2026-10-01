// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Local "stop"/"cancel" spotting on partial transcripts. Runs on every partial, so it is a few string
// operations and no regex backtracking. "Stop" must preempt everything (plan: aborts in < 300 ms).
//
// The stop word must open the utterance (after optional fillers), so "click the stop button" does not
// abort. A partial "stop" that later grows into "stop recording" still aborts the current action: stopping
// is the safe direction.

export type StopKind = "stop" | "cancel";

export interface StopWordHit {
  kind: StopKind;
  /** The word or phrase that matched. */
  word: string;
}

const STOP_WORDS: Readonly<Record<string, StopKind>> = {
  stop: "stop",
  halt: "stop",
  abort: "stop",
  freeze: "stop",
  cancel: "cancel",
  nevermind: "cancel",
};
const STOP_PHRASES: ReadonlyArray<readonly [string, StopKind]> = [
  ["never mind", "cancel"],
  ["forget it", "cancel"],
  ["hold it", "stop"],
];
const FILLERS = new Set([
  "no",
  "wait",
  "hey",
  "ok",
  "okay",
  "uh",
  "um",
  "oh",
  "please",
  "ghosthand",
  "and",
  "so",
]);

/** Lowercase words with punctuation removed. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

/** Detects an opening stop/cancel word in a (partial) transcript. */
export function detectStopWord(partial: string): StopWordHit | undefined {
  const w = words(partial);
  let i = 0;
  while (i < w.length && FILLERS.has(w[i] ?? "")) i++;
  const first = w[i];
  if (first === undefined) return undefined;
  const kind = STOP_WORDS[first];
  if (kind) return { kind, word: first };
  const two = `${first} ${w[i + 1] ?? ""}`;
  for (const [phrase, k] of STOP_PHRASES) if (two === phrase) return { kind: k, word: phrase };
  return undefined;
}
