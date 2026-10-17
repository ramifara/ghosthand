// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `images: "always"` (ADR 0020): the step screenshot rides with act, narrow and verify requests as
// `state.screen`, except right after a secret was typed.
import { type DecisionProvider, err, RunEvent, type RunEventDraft, TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { runTask } from "./loop.ts";
import { estimateImageTokens } from "./screen-image.ts";
import { SecretsRegistry } from "./secrets.ts";
import { choiceOf, FnDecisionProvider, noulOf } from "./testing/fn-decision-provider.ts";
import { fakeElement, ScriptedComputer, type ScriptedScreen } from "./testing/scripted-computer.ts";

function sink() {
  const events: RunEvent[] = [];
  let seq = 0;
  return {
    events,
    emit: (d: RunEventDraft) => {
      events.push(RunEvent.parse({ ...d, t: seq, seq: seq++, runId: "t" }));
    },
  };
}

const screens: Record<string, ScriptedScreen> = {
  login: {
    url: "http://127.0.0.1:4400/login",
    title: "Sign in",
    elements: [
      fakeElement("e1", { role: "textbox", name: "Password", actions: ["set_value"] }),
      fakeElement("e2", { role: "button", name: "Sign in", actions: ["press"] }),
    ],
  },
  home: { url: "http://127.0.0.1:4400/", title: "Home", text: "Welcome back", elements: [] },
};

const task = TaskSpec.parse({
  id: "img",
  instruction: "Sign in with the password",
  startUrl: "http://127.0.0.1:4400/login",
  budget: { steps: 8, seconds: 60, usd: 0.25 },
  secrets: ["PASSWORD"],
  plan: {
    source: "task",
    subgoals: [
      {
        id: "s",
        goal: "Sign in with the password",
        doneWhen: {
          all: [
            { kind: "text", text: "Welcome back" },
            { kind: "model", criteria: "signed in" },
          ],
          none: [],
        },
        allowedEffects: ["advance", "commit"],
        maxSteps: 6,
      },
    ],
  },
});

function computer() {
  let filled = false;
  return new ScriptedComputer({
    screens,
    start: "login",
    transition: (a) => {
      if (a.type === "set_value") filled = true;
      return a.type === "press" && a.token === "e2" && filled ? "home" : undefined;
    },
  });
}

/** Types the password first (a secret), then presses Sign in. */
function provider() {
  return new FnDecisionProvider((q, state) => {
    if (q.holds) return { holds: noulOf(0.9) };
    if (!q.operation) return {};
    const elements = (state as { elements?: Array<{ value?: string }> }).elements ?? [];
    const typed = elements.some((e) => e.value === "[input:PASSWORD]");
    const secretKey =
      q.text?.type === "choice" ? Object.keys(q.text.criteria).find((k) => k.startsWith("sec_")) : undefined;
    if (!typed && secretKey) {
      return {
        operation: choiceOf(q, "operation", "set_value"),
        set_value_target: choiceOf(q, "set_value_target", "e1"),
        text: choiceOf(q, "text", secretKey),
        effect: choiceOf(q, "effect", "advance"),
        goal_done: noulOf(0.1),
        stuck: noulOf(0.05),
      };
    }
    return {
      operation: choiceOf(q, "operation", "press"),
      press_target: choiceOf(q, "press_target", "e2"),
      effect: choiceOf(q, "effect", "commit"),
      goal_done: noulOf(0.2),
      stuck: noulOf(0.05),
    };
  });
}

const base = (c: ScriptedComputer, d: FnDecisionProvider, s = sink()) => ({
  computer: c,
  decision: d,
  events: s,
  secrets: new SecretsRegistry([["PASSWORD", "hunter2-hunter2"]]),
  approve: async () => true,
});

describe("decision.images = always", () => {
  it("attaches the screenshot to act requests as state.screen and counts its tokens", async () => {
    const c = computer();
    const d = provider();
    const s = sink();
    const r = await runTask(task, { ...base(c, d, s), config: { screenshots: false, images: "always" } });
    expect(r.outcome).toBe("success");
    const first = d.requests.find((q) => q.questions.operation);
    expect(first?.images[0]).toMatchObject({
      ref: "<image:screen>",
      mimeType: "image/jpeg",
      width: 1280,
      height: 860,
    });
    expect((first?.state as { screen?: string } | undefined)?.screen).toBe("<image:screen>");
    expect(JSON.stringify(first?.questions.operation)).toContain("`screen`");
    const ev = s.events.find((e) => e.type === "decision.request" && e.purpose === "act");
    expect(ev?.type === "decision.request" && ev.images?.[0]?.tokens).toBe(estimateImageTokens(1280, 860));
    expect(ev?.type === "decision.request" && ev.stateTokens).toBeGreaterThan(estimateImageTokens(1280, 860));
  });

  it("sends no image on the step after a secret was typed, and says so", async () => {
    const c = computer();
    const d = provider();
    const s = sink();
    await runTask(task, { ...base(c, d, s), config: { screenshots: false, images: "always" } });
    const typedStep = s.events.find((e) => e.type === "action" && e.action.type === "set_value");
    expect(typedStep?.type).toBe("action");
    const step = typedStep?.type === "action" ? typedStep.step : -1;
    const next = s.events.find(
      (e) => e.type === "decision.request" && e.purpose === "act" && e.step === step + 1,
    );
    expect(next?.type === "decision.request" && next.images).toBeUndefined();
    expect(next?.type === "decision.request" && next.imageSkipped).toBe("secret_written");
    const later = s.events.find(
      (e) => e.type === "decision.request" && e.purpose === "act" && e.step === step + 2,
    );
    if (later) expect(later.type === "decision.request" && later.images?.length).toBe(1);
  });

  it("gives verify (model done_when) requests the image too", async () => {
    const c = computer();
    const d = provider();
    await runTask(task, { ...base(c, d), config: { screenshots: false, images: "always" } });
    const verify = d.requests.find((q) => q.questions.holds);
    expect(verify?.images[0]?.ref).toBe("<image:screen>");
    expect((verify?.state as { screen?: string } | undefined)?.screen).toBe("<image:screen>");
  });

  it("sends no images with act requests at the default level (grounding)", async () => {
    const c = computer();
    const d = provider();
    const r = await runTask(task, { ...base(c, d), config: { screenshots: false } });
    expect(r.outcome).toBe("success");
    expect(d.requests.filter((q) => q.questions.operation).every((q) => q.images.length === 0)).toBe(true);
  });
});

describe("a computer that cannot mask secrets (desktop hosts)", () => {
  it("sends no image while a secret value is on screen, and says why", async () => {
    // The password field already holds the stored secret when the run starts.
    const filled: Record<string, ScriptedScreen> = {
      login: {
        url: "http://127.0.0.1:4400/login",
        title: "Sign in",
        elements: [
          fakeElement("e1", {
            role: "textbox",
            name: "Password",
            value: "[input:PASSWORD]",
            actions: ["set_value"],
          }),
          fakeElement("e2", { role: "button", name: "Sign in", actions: ["press"] }),
        ],
      },
      home: { url: "http://127.0.0.1:4400/", title: "Home", text: "Welcome back", elements: [] },
    };
    const c = new ScriptedComputer({
      screens: filled,
      start: "login",
      secretMasking: false,
      transition: (a) => (a.type === "press" && a.token === "e2" ? "home" : undefined),
    });
    const d = provider();
    const s = sink();
    const r = await runTask(task, { ...base(c, d, s), config: { screenshots: false, images: "always" } });
    expect(r.outcome).toBe("success");
    const onLogin = s.events.filter(
      (e) => e.type === "decision.request" && e.purpose === "act" && e.step === 1,
    );
    expect(onLogin.length).toBeGreaterThan(0);
    for (const e of onLogin) {
      expect(e.type === "decision.request" && e.images).toBeUndefined();
      expect(e.type === "decision.request" && e.imageSkipped).toBe("secret_on_screen");
    }
    // Requests that did carry an image never showed a field holding a secret value.
    const withImages = d.requests.filter((q) => q.images.length > 0);
    expect(withImages.length).toBeGreaterThan(0);
    for (const q of withImages) {
      const elements = (q.state as { elements?: Array<{ value?: string }> }).elements ?? [];
      expect(elements.some((e) => e.value?.includes("[input:"))).toBe(false);
    }
  });
});

describe("I2: the API rejects the image", () => {
  it("drops the screenshot, re-asks once, and keeps going without images for the rest of the run", async () => {
    const c = computer();
    const inner = provider();
    let rejected = 0;
    const d: DecisionProvider = {
      id: inner.id,
      capabilities: inner.capabilities,
      ask: async (state, questions, opts) => {
        if (opts?.images && opts.images.length > 0) {
          rejected++;
          return err({ kind: "image_rejected", provider: "fn", message: "400 Invalid image dimensions." });
        }
        return inner.ask(state, questions, opts);
      },
    };
    const s = sink();
    const r = await runTask(task, {
      ...base(c, inner, s),
      decision: d,
      config: { screenshots: false, images: "always" },
    });
    expect(r.outcome).toBe("success");
    expect(rejected).toBe(1);
    const acts = s.events.filter((e) => e.type === "decision.request" && e.purpose === "act");
    expect(acts.length).toBeGreaterThanOrEqual(2);
    const afterFirst = acts.slice(1);
    for (const e of afterFirst)
      expect(e.type === "decision.request" && e.imageSkipped).toBe("image_rejected");
  });
});
