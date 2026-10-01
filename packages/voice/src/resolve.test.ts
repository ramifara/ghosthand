// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { ScriptedDecisionProvider } from "@ghosthand/core";
import type { Answer } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { byName, invoicePage } from "./__fixtures__/invoice-page.ts";
import { FocusStack } from "./focus-stack.ts";
import { type ResolveContext, resolveUtterance, type VoiceResolution } from "./resolve.ts";

const choice = (picked: string, p: Record<string, number>): Answer => ({
  type: "choice",
  choice: picked,
  confidence: p[picked] ?? 0,
  probabilities: p,
});

function ctx(
  answers: Array<Record<string, Answer>> = [],
): ResolveContext & { jev: ScriptedDecisionProvider } {
  const jev = new ScriptedDecisionProvider({
    model: "jev-test",
    calls: answers.map((a) => ({ answers: a, usage: { inputTokens: 100, outputTokens: 1 }, latencyMs: 200 })),
  });
  return { snapshot: invoicePage(), focus: new FocusStack(), decision: jev, jev };
}

const action = (r: VoiceResolution) => (r.kind === "action" ? r : undefined);

describe("resolveUtterance: code-only targets (no Jev call)", () => {
  it("exact names", async () => {
    const c = ctx();
    const r = await resolveUtterance("click settings", c);
    expect(action(r.resolution)?.action).toEqual({
      type: "press",
      token: byName(c.snapshot, "Settings").token,
    });
    expect(action(r.resolution)?.via).toBe("name");
    expect(c.jev.requests).toHaveLength(0);
    // Row context disambiguates without a model call.
    const ctxHit = await resolveUtterance("click the unpaid globex invoice", c);
    expect(action(ctxHit.resolution)?.element?.name).toBe("Invoice #1042");
  });

  it("ordinals over whole-word matches in reading order", async () => {
    const c = ctx();
    const r = await resolveUtterance("click the second invoice", c);
    expect(action(r.resolution)?.element?.name).toBe("Invoice #1042");
    const last = await resolveUtterance("open the last invoice", c);
    expect(action(last.resolution)?.element?.name).toBe("Invoice #1043");
    const third = await resolveUtterance("click the third link", c);
    expect(action(third.resolution)?.element?.name).toBe("Settings");
  });

  it("badges come from the focus stack; unshown numbers are not guessed", async () => {
    const c = ctx();
    const noBadges = await resolveUtterance("click 2", c);
    expect(noBadges.resolution).toMatchObject({
      kind: "unresolved",
      reason: expect.stringContaining("show numbers"),
    });
    c.focus.showBadges([byName(c.snapshot, "Export CSV"), byName(c.snapshot, "Next")]);
    const r = await resolveUtterance("click 2", c);
    expect(action(r.resolution)?.element?.name).toBe("Next");
    expect(action(r.resolution)?.via).toBe("badge");
  });

  it("deixis: this/that resolve to the highlight, next to the following mentioned item", async () => {
    const c = ctx();
    c.focus.mention([1041, 1042, 1043].map((n) => byName(c.snapshot, `Invoice #${n}`)));
    c.focus.acted(byName(c.snapshot, "Invoice #1041"));
    expect(action((await resolveUtterance("click that", c)).resolution)?.element?.name).toBe("Invoice #1041");
    expect(action((await resolveUtterance("click the next one", c)).resolution)?.element?.name).toBe(
      "Invoice #1042",
    );
    expect(action((await resolveUtterance("the second one", c)).resolution)?.element?.name).toBe(
      "Invoice #1042",
    );
  });

  it("fill, check, select and type map to element actions", async () => {
    const c = ctx();
    const fill = action((await resolveUtterance("fill email with rami@example.com", c)).resolution);
    expect(fill?.action).toEqual({
      type: "set_value",
      token: byName(c.snapshot, "Email").token,
      value: "rami@example.com",
    });
    const check = action((await resolveUtterance("check remember me", c)).resolution);
    expect(check?.action).toEqual({
      type: "toggle",
      token: byName(c.snapshot, "Remember me").token,
      checked: true,
    });
    const sel = action((await resolveUtterance("select germany from the country dropdown", c)).resolution);
    expect(sel?.action).toEqual({
      type: "select_option",
      token: byName(c.snapshot, "Country").token,
      option: "Germany",
    });
    const typed = action((await resolveUtterance("type hello", c)).resolution);
    expect(typed?.action).toEqual({ type: "type_text", text: "hello" });
  });

  it("targetless verbs", async () => {
    const c = ctx();
    expect(action((await resolveUtterance("scroll down three times", c)).resolution)?.action).toEqual({
      type: "scroll",
      dx: 0,
      dy: 1200,
    });
    expect(action((await resolveUtterance("press escape", c)).resolution)?.action).toEqual({
      type: "key",
      keys: ["Escape"],
    });
    expect(action((await resolveUtterance("go back", c)).resolution)?.action).toEqual({ type: "back" });
    expect(action((await resolveUtterance("go to example dot com", c)).resolution)?.action).toEqual({
      type: "navigate",
      url: "https://example.com",
    });
    expect(action((await resolveUtterance("next page", c)).resolution)?.element?.name).toBe("Next");
    expect((await resolveUtterance("stop", c)).resolution.kind).toBe("control");
    expect((await resolveUtterance("show numbers", c)).resolution.kind).toBe("control");
  });
});

describe("resolveUtterance: confirmation for risky effects (core combineEffect)", () => {
  it("destructive and submitting elements need confirmation", async () => {
    const c = ctx();
    const del = action((await resolveUtterance("click delete selected", c)).resolution);
    expect(del).toMatchObject({ effect: "commit", needsConfirmation: true });
    const submit = action((await resolveUtterance("submit", c)).resolution);
    expect(submit).toMatchObject({ effect: "commit", needsConfirmation: true });
    expect(submit?.element?.name).toBe("Save");
    const nav = action((await resolveUtterance("click settings", c)).resolution);
    expect(nav).toMatchObject({ effect: "advance", needsConfirmation: false });
  });
});

describe("resolveUtterance: Jev steps", () => {
  it("asks a target question over name matches and records the choice for 'the other one'", async () => {
    const c = ctx();
    const tokens = [1041, 1042, 1043].map((n) => byName(c.snapshot, `Invoice #${n}`).token);
    const [t1, t2, t3] = tokens as [string, string, string];
    c.jev = new ScriptedDecisionProvider({
      model: "jev-test",
      calls: [
        {
          answers: {
            press_target: choice(t2, { [t1]: 0.05, [t2]: 0.8, [t3]: 0.12, none: 0.02, ambiguous: 0.01 }),
          },
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        },
      ],
    });
    c.decision = c.jev;
    const r = await resolveUtterance("click the invoice from globex", c);
    expect(action(r.resolution)?.element?.name).toBe("Invoice #1042");
    expect(action(r.resolution)?.via).toBe("jev");
    const asked = c.jev.requests[0];
    expect(Object.keys(asked?.questions ?? {})).toEqual(["press_target"]);
    expect(r.decision?.response?.model).toBe("jev-test");
    // Code may act on it; then "no, the other one" picks the runner-up without another call.
    c.focus.acted(byName(c.snapshot, "Invoice #1042"));
    const other = await resolveUtterance("no, the other one", c);
    expect(other.resolution.kind).toBe("control");
    expect(c.focus.resolveDeixis("other", c.snapshot)?.name).toBe("Invoice #1043");
  });

  it("low target confidence asks the user to clarify among the top candidates", async () => {
    const c = ctx();
    const [a, b] = [byName(c.snapshot, "Invoice #1041").token, byName(c.snapshot, "Invoice #1043").token];
    c.jev = new ScriptedDecisionProvider({
      model: "jev-test",
      calls: [
        {
          answers: { press_target: choice(a, { [a]: 0.48, [b]: 0.45, none: 0.04, ambiguous: 0.03 }) },
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        },
      ],
    });
    c.decision = c.jev;
    const r = await resolveUtterance("click invoice", c);
    expect(r.resolution.kind).toBe("clarify");
    if (r.resolution.kind === "clarify")
      expect(r.resolution.candidates.map((e) => e.name)).toEqual(["Invoice #1041", "Invoice #1043"]);
  });

  it("unknown utterances get an intent + target request; 'none' goes to the planner", async () => {
    const c = ctx();
    const save = byName(c.snapshot, "Save").token;
    c.jev = new ScriptedDecisionProvider({
      model: "jev-test",
      calls: [
        {
          answers: {
            intent: choice("click", { click: 0.9, none: 0.1 }),
            press_target: choice(save, { [save]: 0.92, none: 0.08 }),
          },
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        },
        {
          answers: { intent: choice("none", { none: 0.85, click: 0.15 }) },
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        },
      ],
    });
    c.decision = c.jev;
    const r = await resolveUtterance("the blue thing on the left", c);
    expect(action(r.resolution)).toMatchObject({
      command: { verb: "click", source: "jev" },
      needsConfirmation: true,
    });
    const q = c.jev.requests[0]?.questions ?? {};
    expect(Object.keys(q)).toEqual([
      "intent",
      "press_target",
      "set_value_target",
      "toggle_target",
      "select_option_target",
    ]);
    const g = await resolveUtterance("what's this", c);
    expect(g.resolution).toEqual({ kind: "goal", goal: "what's this" });
  });

  it("multi-step requests go straight to the planner", async () => {
    const c = ctx();
    const r = await resolveUtterance("open settings and then change my email", c);
    expect(r.resolution).toEqual({ kind: "goal", goal: "open settings and then change my email" });
    expect(c.jev.requests).toHaveLength(0);
  });

  it("without a decision provider, unclear targets come back for clarification", async () => {
    const c = ctx();
    const { decision: _drop, ...noJev } = c;
    const r = await resolveUtterance("click invoice", noJev);
    expect(r.resolution.kind).toBe("clarify");
  });
});
