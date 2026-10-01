// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Drives the real X11 sandbox (container or host Xvfb) with the GTK testbed. Skipped when neither a container
// runtime nor Xvfb is available, or with GHOSTHAND_SKIP_SANDBOX_TESTS=1. Never touches the user's display.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SecretsRegistry } from "@ghosthand/core";
import type { Element, Snapshot } from "@ghosthand/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { X11Sandbox } from "./x11-sandbox.ts";
import { detectRuntime, launchX11Sandbox, testbedApp } from "./x11-sandbox.ts";

const runtime = process.env.GHOSTHAND_SKIP_SANDBOX_TESTS === "1" ? undefined : await detectRuntime();
const find = (s: Snapshot, role: string, name: string, context?: string): Element => {
  const el = s.elements.find(
    (e) => e.role === role && e.name === name && (context === undefined || e.context === context),
  );
  if (!el)
    throw new Error(`no ${role} "${name}" in ${s.elements.map((e) => `${e.role}:${e.name}`).join(", ")}`);
  return el;
};

describe.skipIf(runtime === undefined)("X11 sandbox (live)", () => {
  let sb: X11Sandbox;
  const secrets = new SecretsRegistry([["TESTBED_EMAIL_SECRET", "ada@example.com"]]);

  beforeAll(async () => {
    const workDir = undefined;
    const first = await launchX11Sandbox({ secrets, ...(workDir ? { workDir } : {}) });
    if (!first.ok) throw new Error(first.error.message);
    sb = first.value;
    const opened = await sb.computer.open(
      `app:${testbedApp(sb.runtime, sb.sandboxWorkDir)
        .argv.map((a) => JSON.stringify(a))
        .join(" ")}`,
    );
    if (!opened.ok) throw new Error(opened.error.message);
  });

  afterAll(async () => {
    await sb?.computer.close();
  });

  it("observes the testbed with ARIA roles, context and exact bounds", async () => {
    const r = await sb.computer.observe();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value;
    expect(s.surface).toBe("x11");
    const name = find(s, "textbox", "Full name");
    expect(name.boundsTrust).toBe("exact");
    expect(name.value).toBe("<empty>");
    expect(find(s, "combobox", "Plan").options).toEqual(["Free", "Pro", "Team"]);
    expect(find(s, "checkbox", "Subscribe to the newsletter").states).toContain("unchecked");
    const removeBread = find(s, "button", "Remove", "Bread");
    expect(removeBread.risk).toBe("destructive");
    expect(find(s, "button", "Save profile").risk).toBe("submits");
    expect(s.text).toContain("Shopping list");
    // Same-named buttons get distinct stable ids from their rows.
    const removes = s.elements.filter((e) => e.name === "Remove").map((e) => e.stableId);
    expect(new Set(removes).size).toBe(removes.length);
  });

  it("acts semantically with read-back effects and refuses stale tokens", async () => {
    let s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    const name = find(s.value, "textbox", "Full name");
    const set = await sb.computer.setValue(name.token, "Ada Lovelace");
    expect(set.effect).toBe("confirmed");
    expect(set.route).toBe("semantic");
    const stale = await sb.computer.press(name.token);
    expect(stale.effect).toBe("refused");
    expect(stale.error?.kind).toBe("stale_token");

    s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    const email = await sb.computer.setValue(find(s.value, "textbox", "Email").token, {
      secretRef: "TESTBED_EMAIL_SECRET",
    });
    expect(email.effect).toBe("confirmed");
    expect(JSON.stringify(email)).not.toContain("ada@example.com");

    s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    expect(find(s.value, "textbox", "Email").value).toBe("[input:TESTBED_EMAIL_SECRET]");
    const plan = await sb.computer.selectOption(find(s.value, "combobox", "Plan").token, "Pro");
    expect(plan.effect).toBe("confirmed");

    s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    const news = await sb.computer.toggle(
      find(s.value, "checkbox", "Subscribe to the newsletter").token,
      true,
    );
    expect(news.effect).toBe("confirmed");

    s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    const save = await sb.computer.press(find(s.value, "button", "Save profile").token);
    expect(save.effect).toBe("confirmed");

    const state = JSON.parse(readFileSync(join(sb.workDir, "state.json"), "utf8")) as {
      profile: { name: string; email: string; plan: string; newsletter: boolean } | null;
    };
    expect(state.profile).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      plan: "Pro",
      newsletter: true,
    });
  });

  it("removes a list row and types through XTest", async () => {
    let s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    const r = await sb.computer.press(find(s.value, "button", "Remove", "Bread").token);
    expect(r.effect).toBe("confirmed");
    s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    expect(s.value.elements.some((e) => e.context === "Bread")).toBe(false);

    const field = find(s.value, "textbox", "New item");
    const click = await sb.computer.click({ token: field.token });
    expect(click.route).toBe("pointer");
    expect(click.effect).not.toBe("refused");
    const typed = await sb.computer.typeText("Milk");
    expect(typed.effect, JSON.stringify({ click, typed })).toBe("confirmed");
    const enter = await sb.computer.key(["Enter"]);
    expect(enter.effect).not.toBe("refused");
    const state = JSON.parse(readFileSync(join(sb.workDir, "state.json"), "utf8")) as { items: string[] };
    expect(state.items).toEqual(["Eggs", "Coffee", "Milk"]);
  });

  it("takes screenshots and maps capture pixels to screen points", async () => {
    const shot = await sb.computer.screenshot();
    expect(shot.ok).toBe(true);
    if (!shot.ok) return;
    expect(shot.value.capture.width).toBe(1280);
    expect(Array.from(shot.value.data.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    const moved = await sb.computer.move({ captureId: shot.value.capture.id, x: 10, y: 10 });
    expect(moved.effect).not.toBe("refused");
  });

  it("verifies predicates without invalidating the latest snapshot", async () => {
    const s = await sb.computer.observe();
    if (!s.ok) throw new Error(s.error.message);
    const res = await sb.computer.verify([{ kind: "text", text: "Added Milk" }]);
    expect(res[0]?.state).toBe("satisfied");
    const focus = await sb.computer.focus(find(s.value, "textbox", "Full name").token);
    expect(focus.effect).not.toBe("refused");
  });
});
