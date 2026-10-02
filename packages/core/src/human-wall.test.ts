// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { RunEventDraft, Snapshot } from "@ghosthand/protocol";
import { TaskSpec } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { detectHumanWall } from "./human-wall.ts";
import { runTask } from "./loop.ts";
import { SecretsRegistry } from "./secrets.ts";
import { FakeLoginComputer } from "./testing/fake-login-computer.ts";
import { HeuristicDecisionProvider } from "./testing/heuristic-decision-provider.ts";

const snap = (text: string, names: string[] = []): Snapshot => ({
  id: "s",
  surface: "web",
  takenAt: 0,
  title: "",
  viewport: { x: 0, y: 0, width: 1, height: 1 },
  elements: names.map((name, i) => ({
    token: `e${i}`,
    stableId: name,
    role: "button",
    roleClass: "button",
    nativeRole: "button",
    name,
    states: [],
    actions: ["press"],
    bounds: null,
    visibleBounds: null,
    boundsTrust: "none",
    region: "main",
    frame: "main",
    risk: "safe",
  })),
  text,
  tokenEstimate: 0,
  quality: { elementCount: names.length, unnamedInteractive: 0, score: 1 },
  narrowed: false,
});

describe("detectHumanWall", () => {
  it("finds CAPTCHAs, human checks and phone verification", () => {
    expect(detectHumanWall(snap("Please complete the reCAPTCHA below"))?.kind).toBe("captcha");
    expect(detectHumanWall(snap("", ["I'm not a robot"]))?.kind).toBe("human check");
    expect(detectHumanWall(snap("Verify your phone number to continue"))?.kind).toBe("phone verification");
  });
  it("leaves email codes, magic links and TOTP to the agent", () => {
    expect(detectHumanWall(snap("Enter the code we sent to alice@testbed.local"))).toBeUndefined();
    expect(detectHumanWall(snap("Enter the 6-digit code from your authenticator app"))).toBeUndefined();
    expect(detectHumanWall(snap("Check your email for a sign-in link"))).toBeUndefined();
  });
  it("does not pause on vendor mentions, attribution links or frame names", () => {
    for (const text of [
      "Protected by reCAPTCHA",
      "Cloudflare Turnstile documentation",
      "Configure hCaptcha",
      "Turnstile verification succeeded",
    ]) {
      const s = snap(text, ["Sign in"]);
      s.elements = s.elements.map((e) => ({
        ...e,
        frame: "main > recaptcha",
        href: "https://example.com/captcha",
      }));
      expect(detectHumanWall(s), text).toBeUndefined();
    }
    const linked = snap("", ["reCAPTCHA"]);
    linked.elements = linked.elements.map((e) => ({ ...e, role: "link", roleClass: "link" }));
    expect(detectHumanWall(linked)).toBeUndefined();
  });
  it("keeps active CAPTCHA controls and explicit challenge instructions blocked", () => {
    expect(detectHumanWall(snap("", ["reCAPTCHA"]))?.kind).toBe("captcha");
    expect(detectHumanWall(snap("Please solve this CAPTCHA"))?.kind).toBe("captcha");
    expect(detectHumanWall(snap("", ["Confirm you are human"]))?.kind).toBe("human check");
  });
  it("continues after a person checks the verification checkbox", () => {
    const s = snap("I'm not a robot", ["I'm not a robot"]);
    s.elements = s.elements.map((e) => ({
      ...e,
      role: "checkbox",
      roleClass: "checkbox",
      states: ["checked"],
    }));
    expect(detectHumanWall(s)).toBeUndefined();
    s.text += " Verify you are human before continuing";
    expect(detectHumanWall(s)?.kind).toBe("human check");
  });
});

class WallComputer extends FakeLoginComputer {
  wall = true;
  override async observe() {
    const r = await super.observe();
    if (r.ok && this.wall) return { ...r, value: { ...r.value, text: "Verify you are human" } };
    return r;
  }
}

function setup() {
  const secrets = new SecretsRegistry([["PW", "pw-123456"]]);
  const computer = new WallComputer({ email: "a@b.co", passwordSecret: "PW", secrets });
  const events: RunEventDraft[] = [];
  const task = TaskSpec.parse({
    id: "w",
    instruction: "Sign in",
    startUrl: "http://x/login",
    secrets: ["PW"],
  });
  return { secrets, computer, events, task };
}

describe("human-verification walls in the loop", () => {
  it("ends at once with the reason when nobody can take over (no model calls)", async () => {
    const { secrets, computer, events, task } = setup();
    const decision = new HeuristicDecisionProvider();
    const r = await runTask(task, {
      computer,
      decision,
      secrets,
      events: { emit: (d) => events.push(d) },
      config: { screenshots: false },
    });
    expect(r.outcome).toBe("stuck");
    expect(r.reason).toContain("human verification (human check)");
    expect(r.decisionCalls).toBe(0);
  });
  it("hands over to the person watching and continues after they resume", async () => {
    const { secrets, computer, events, task } = setup();
    let asked = "";
    const control = {
      requestHuman: (reason: string) => {
        asked = reason;
        return true;
      },
      checkpoint: async () => {
        if (!asked) return 0; // not paused
        computer.wall = false; // the human solved it
        return 1500;
      },
    };
    const r = await runTask(task, {
      computer,
      decision: new HeuristicDecisionProvider(),
      secrets,
      control,
      events: { emit: (d) => events.push(d) },
      config: { screenshots: false },
    });
    expect(asked).toContain("human check");
    expect(events.some((e) => e.type === "human" && e.kind === "takeover")).toBe(true);
    expect(r.reason).not.toContain("human verification");
  });
});
