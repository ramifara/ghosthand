// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { VoiceCommand } from "@ghosthand/protocol";
import { VoiceCommand as VoiceCommandSchema } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { describeCommand, normalizeUtterance, parseTarget, parseUtterance, spokenUrl } from "./grammar.ts";

type Expected = Partial<Omit<VoiceCommand, "utterance" | "source">>;

/** [utterance, expected command fields]. Unlisted optional fields must be absent. */
const COMMANDS: Array<[string, Expected]> = [
  // control
  ["stop", { verb: "stop" }],
  ["Stop!", { verb: "stop" }],
  ["stop it", { verb: "stop" }],
  ["cancel", { verb: "cancel" }],
  ["never mind", { verb: "cancel" }],
  ["undo", { verb: "undo" }],
  ["undo that", { verb: "undo" }],
  ["wait", { verb: "wait" }],
  ["hold on", { verb: "wait" }],
  ["continue", { verb: "continue" }],
  ["keep going", { verb: "continue" }],
  ["yes", { verb: "confirm" }],
  ["Yes, do it.", { verb: "confirm" }],
  ["confirm", { verb: "confirm" }],
  ["no", { verb: "deny" }],
  ["nope", { verb: "deny" }],
  ["repeat that", { verb: "repeat" }],
  ["do it again", { verb: "repeat" }],
  ["help", { verb: "help" }],
  ["what can I say?", { verb: "help" }],
  // meta
  ["start recording", { verb: "start_recording" }],
  ["stop recording", { verb: "stop_recording" }],
  ["save as recipe monthly invoices", { verb: "save_recipe", value: "monthly invoices" }],
  ["save this as a recipe called weekly report", { verb: "save_recipe", value: "weekly report" }],
  // overlays
  ["show numbers", { verb: "show_numbers" }],
  ["show labels", { verb: "show_numbers" }],
  ["hide numbers", { verb: "hide_numbers" }],
  ["show grid", { verb: "show_grid" }],
  // navigation
  ["go back", { verb: "back" }],
  ["back", { verb: "back" }],
  ["go forward", { verb: "forward" }],
  ["reload", { verb: "reload" }],
  ["refresh the page", { verb: "reload" }],
  ["open a new tab", { verb: "new_tab" }],
  ["close this tab", { verb: "close_tab" }],
  ["next page", { verb: "next_page" }],
  ["go to the previous page", { verb: "previous_page" }],
  ["go to example dot com", { verb: "navigate", value: "example.com" }],
  ["open github.com/ramifara", { verb: "navigate", value: "github.com/ramifara" }],
  ["navigate to localhost:4400/login", { verb: "navigate", value: "localhost:4400/login" }],
  // scrolling
  ["scroll down", { verb: "scroll_down" }],
  ["scroll", { verb: "scroll_down" }],
  ["scroll down three times", { verb: "scroll_down", value: "3" }],
  ["scroll up a bit", { verb: "scroll_up", value: "1" }],
  ["scroll down a lot", { verb: "scroll_down", value: "5" }],
  ["scroll to the top", { verb: "scroll_top" }],
  ["go to the bottom of the page", { verb: "scroll_bottom" }],
  ["page down", { verb: "page_down" }],
  ["page up", { verb: "page_up" }],
  // keys
  ["press enter", { verb: "press_key", value: "Enter" }],
  ["hit escape", { verb: "press_key", value: "Escape" }],
  ["press tab", { verb: "press_key", value: "Tab" }],
  ["press the down arrow key", { verb: "press_key", value: "ArrowDown" }],
  // text
  ["type hello world", { verb: "type", value: "hello world" }],
  [
    "type rami@example.com into the email field",
    { verb: "type", value: "rami@example.com", target: "email", role: "textbox" },
  ],
  ["fill name with Rami Fara", { verb: "fill", target: "name", value: "rami fara" }],
  [
    "fill in the email field with test@example.com",
    { verb: "fill", target: "email", role: "textbox", value: "test@example.com" },
  ],
  ["set quantity to five", { verb: "fill", target: "quantity", value: "five" }],
  ["enter 42 in the amount box", { verb: "fill", target: "amount", value: "42" }],
  ["clear", { verb: "clear" }],
  ["clear the search box", { verb: "clear", role: "searchbox" }],
  ["submit", { verb: "submit" }],
  ["submit the form", { verb: "submit" }],
  // pointing
  ["click settings", { verb: "click", target: "settings" }],
  ["click on the save button", { verb: "click", target: "save", role: "button" }],
  ["press the delete button", { verb: "click", target: "delete", role: "button" }],
  ["tap sign in", { verb: "click", target: "sign in" }],
  ["click 12", { verb: "click", badge: 12 }],
  ["click number twelve", { verb: "click", badge: 12 }],
  ["click on twenty one", { verb: "click", badge: 21 }],
  ["7", { verb: "click", badge: 7 }],
  ["number to", { verb: "click", badge: 2 }],
  ["click the second invoice", { verb: "click", ordinal: 2, target: "invoice" }],
  ["click the third link", { verb: "click", ordinal: 3, role: "link" }],
  ["open the last result", { verb: "open", ordinal: -1, role: "listitem" }],
  ["click the 2nd one", { verb: "click", ordinal: 2 }],
  ["the second one", { verb: "click", ordinal: 2 }],
  ["click this", { verb: "click", deixis: "this" }],
  ["click that one", { verb: "click", deixis: "that" }],
  ["that one", { verb: "click", deixis: "that" }],
  ["press it", { verb: "click", deixis: "it" }],
  ["click the next one", { verb: "click", deixis: "next" }],
  ["click the one below", { verb: "click", deixis: "next" }],
  ["click this button", { verb: "click", deixis: "this", role: "button" }],
  ["open settings", { verb: "open", target: "settings" }],
  ["go to settings", { verb: "open", target: "settings" }],
  ["show me the billing page", { verb: "open", target: "billing page" }],
  [
    "select germany from the country dropdown",
    { verb: "select", target: "country", role: "combobox", value: "germany" },
  ],
  ["choose the first option", { verb: "select", ordinal: 1, role: "option" }],
  ["check remember me", { verb: "check", target: "remember me" }],
  ["tick the terms checkbox", { verb: "check", target: "terms", role: "checkbox" }],
  ["uncheck newsletter", { verb: "uncheck", target: "newsletter" }],
  ["focus on the search field", { verb: "focus", target: "search", role: "textbox" }],
  ["hover over the profile menu", { verb: "hover", target: "profile", role: "menu" }],
  // fillers
  ["please click settings", { verb: "click", target: "settings" }],
  ["okay can you scroll down please", { verb: "scroll_down" }],
  ["hey ghosthand go back", { verb: "back" }],
  // corrections
  ["no, the other one", { verb: "correct", deixis: "other", correction: true }],
  ["not that one", { verb: "correct", deixis: "other", correction: true }],
  ["wrong one", { verb: "correct", deixis: "other", correction: true }],
  ["the other one", { verb: "correct", deixis: "other", correction: true }],
  ["no, the second one", { verb: "correct", ordinal: 2, correction: true }],
  ["no the third invoice", { verb: "correct", ordinal: 3, target: "invoice", correction: true }],
  ["no, click save", { verb: "click", target: "save", correction: true }],
  ["actually click cancel", { verb: "click", target: "cancel", correction: true }],
  ["no, number four", { verb: "correct", badge: 4, correction: true }],
  ["no, stop", { verb: "stop", correction: true }],
  ["I meant the billing tab", { verb: "correct", target: "billing", role: "tab", correction: true }],
];

const GOALS = [
  "find the latest unpaid invoice and download it",
  "open settings and then change my email to rami@example.com",
  "search for wireless headphones",
  "fill the form with my test data",
  "log in with the test account",
  "click the invoices tab then open the second invoice",
  "delete the draft named quarterly report",
  "go to the orders page, filter by last month and export them as a csv file please",
];

const UNKNOWN = ["the blue thing on the left", "what's this", "invoices"];

describe("parseUtterance: commands", () => {
  it(`has at least 60 command utterances (${COMMANDS.length})`, () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(COMMANDS)("%s", (utterance, expected) => {
    const r = parseUtterance(utterance);
    expect(r.kind, JSON.stringify(r)).toBe("command");
    if (r.kind !== "command") return;
    const c = r.command;
    expect(VoiceCommandSchema.safeParse(c).success).toBe(true);
    expect(c.source).toBe("grammar");
    expect({
      verb: c.verb,
      target: c.target,
      role: c.role,
      ordinal: c.ordinal,
      badge: c.badge,
      deixis: c.deixis,
      value: c.value,
      correction: c.correction,
    }).toEqual({
      target: undefined,
      role: undefined,
      ordinal: undefined,
      badge: undefined,
      deixis: undefined,
      value: undefined,
      correction: false,
      ...expected,
    });
  });
});

describe("parseUtterance: goals and unknowns", () => {
  it.each(GOALS)("goal: %s", (utterance) => {
    const r = parseUtterance(utterance);
    expect(r.kind).toBe("goal");
    if (r.kind === "goal") expect(r.goal).toBe(utterance);
  });

  it.each(UNKNOWN)("unknown: %s", (utterance) => {
    expect(parseUtterance(utterance).kind).toBe("unknown");
  });

  it("empty input", () => {
    expect(parseUtterance("  ").kind).toBe("empty");
    expect(parseUtterance("um").kind).toBe("empty");
  });

  it("parses in well under 5 ms", () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) for (const [u] of COMMANDS) parseUtterance(u);
    const perCall = (performance.now() - start) / (200 * COMMANDS.length);
    expect(perCall).toBeLessThan(5);
  });
});

describe("helpers", () => {
  it("normalizes punctuation and fillers", () => {
    expect(normalizeUtterance("  Okay, please Click   Save!  ")).toBe("click save");
    expect(normalizeUtterance("Go to example.com.")).toBe("go to example.com");
  });

  it("parses spoken URLs", () => {
    expect(spokenUrl("docs dot example dot com slash api")).toBe("docs.example.com/api");
  });

  it("parses targets", () => {
    expect(parseTarget("the second to last row")).toEqual({ ordinal: -2, role: "row" });
    expect(parseTarget("the sign up link")).toEqual({ target: "sign up", role: "link" });
    expect(parseTarget("the previous one")).toEqual({ deixis: "previous" });
  });

  it("describes commands for the intent chip", () => {
    const r = parseUtterance("click the second invoice");
    expect(r.kind === "command" && describeCommand(r.command)).toBe('click → "invoice" #2');
    const f = parseUtterance("fill name with Rami");
    expect(f.kind === "command" && describeCommand(f.command)).toBe('fill → "name" = "rami"');
  });
});
