// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Voice commands (Phase 4). A transcript is parsed into one VoiceCommand; the engine resolves it against the
// current element table. The desktop overlay shows it as the parsed-intent chip, so it lives here.
import { z } from "zod";

/** The closed command grammar (research note voice-mode.md §5, "about 40 verbs"). */
export const VOICE_VERBS = [
  // navigation
  "back",
  "forward",
  "reload",
  "navigate",
  "new_tab",
  "close_tab",
  "next_page",
  "previous_page",
  // pointing
  "click",
  "open",
  "select",
  "check",
  "uncheck",
  "focus",
  "hover",
  "show_numbers",
  "hide_numbers",
  "show_grid",
  // text
  "type",
  "fill",
  "clear",
  "submit",
  "press_key",
  // scrolling
  "scroll_up",
  "scroll_down",
  "scroll_top",
  "scroll_bottom",
  "page_up",
  "page_down",
  // control
  "stop",
  "cancel",
  "undo",
  "wait",
  "continue",
  "confirm",
  "deny",
  "repeat",
  "correct",
  // meta
  "start_recording",
  "stop_recording",
  "save_recipe",
  "help",
] as const;
export const VoiceVerb = z.enum(VOICE_VERBS);
export type VoiceVerb = z.infer<typeof VoiceVerb>;

/**
 * Pointing words resolved in code from the focus stack:
 * this/that/it → current highlight or last acted element; other → runner-up of the last choice;
 * next/previous → neighbour of the focus within the last-mentioned set.
 */
export const Deixis = z.enum(["this", "that", "it", "other", "next", "previous"]);
export type Deixis = z.infer<typeof Deixis>;

export const VoiceCommandSource = z.enum(["grammar", "jev"]);
export type VoiceCommandSource = z.infer<typeof VoiceCommandSource>;

export const VoiceCommand = z.object({
  verb: VoiceVerb,
  /** Free-text target as spoken ("settings", "invoice 1042"), without articles or ordinals. */
  target: z.string().min(1).optional(),
  /** Role noun that narrows the target ("button", "link", "row"), when spoken. */
  role: z.string().min(1).optional(),
  /** 1-based ordinal ("the second" → 2); -1 means "the last". */
  ordinal: z.number().int().optional(),
  /** Number badge ("click 12" while numbers are shown). */
  badge: z.number().int().positive().optional(),
  deixis: Deixis.optional(),
  /** Typed text, key name, URL, scroll amount or recipe name, depending on the verb. */
  value: z.string().optional(),
  /** True for "no, ..." / "not that, ..." corrections of the previous command. */
  correction: z.boolean(),
  /** The normalized utterance the command was parsed from. */
  utterance: z.string(),
  source: VoiceCommandSource,
});
export type VoiceCommand = z.infer<typeof VoiceCommand>;
