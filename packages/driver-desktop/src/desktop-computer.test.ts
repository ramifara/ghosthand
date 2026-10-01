// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretsRegistry } from "@ghosthand/core";
import type { ActParams, ActResult, InputParams, RpcGlobalProbe } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { DesktopComputer, splitCommand } from "./desktop-computer.ts";
import { gtkTestbedSnapshot, ScriptedTransport, X11_HELLO } from "./test-support.ts";

const G: RpcGlobalProbe = { windows: ["frame:GhostHand Desktop Testbed"], events: 10, contentHash: "aa" };

function setup(secrets = new SecretsRegistry()) {
  const t = new ScriptedTransport();
  let seq = 0;
  t.on("observe", () => ({ ...gtkTestbedSnapshot(), snapshotId: `h${++seq}` }));
  const computer = new DesktopComputer({ transport: t, hello: X11_HELLO, surface: "x11", secrets });
  return { t, computer };
}

const tokenOf = async (c: DesktopComputer, role: string, name: string, context?: string) => {
  const s = await c.observe();
  if (!s.ok) throw new Error(s.error.message);
  const el = s.value.elements.find(
    (e) => e.role === role && e.name === name && (context === undefined || e.context === context),
  );
  if (!el) throw new Error(`no ${role} ${name}`);
  return el;
};

describe("DesktopComputer", () => {
  it("builds a snapshot for the x11 surface", async () => {
    const { computer } = setup();
    const s = await computer.observe();
    expect(s.ok && s.value.surface).toBe("x11");
    expect(s.ok && s.value.viewport).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
    expect(computer.capabilities()).toMatchObject({ surface: "x11", pointer: true });
  });

  it("acts on the host ref of a fresh token and refuses stale ones without calling the host", async () => {
    const { t, computer } = setup();
    const el = await tokenOf(computer, "button", "Save profile");
    t.on("act", (p: ActParams): ActResult => {
      expect(p.op).toBe("press");
      expect(p.snapshotId).toBe("h1");
      return {
        ok: true,
        route: "semantic",
        nativeRoute: "atspi.do_action(click)",
        before: { name: "Save profile", states: [] },
        after: { name: "Save profile", states: [] },
        globalBefore: G,
        globalAfter: { ...G, events: 12, contentHash: "bb" },
      };
    });
    const r = await computer.press(el.token);
    expect(r.effect).toBe("confirmed");
    expect(r.route).toBe("semantic");
    expect(r.invalidatedSnapshots).toEqual(["d1"]);
    const again = await computer.press(el.token);
    expect(again).toMatchObject({ effect: "refused", error: { kind: "stale_token" } });
    expect(t.calls.filter((c) => c.method === "act")).toHaveLength(1);
  });

  it("resolves secrets only for the host call and redacts them from evidence", async () => {
    const secrets = new SecretsRegistry([["EMAIL", "ada@example.com"]]);
    const { t, computer } = setup(secrets);
    const el = await tokenOf(computer, "textbox", "Email");
    t.on("act", (p) => ({
      ok: true,
      route: "semantic",
      nativeRoute: "atspi.editable_text.set_text_contents",
      before: { name: "Email", states: [], value: "" },
      after: { name: "Email", states: [], value: p.value ?? "" },
      globalBefore: G,
      globalAfter: G,
    }));
    const r = await computer.setValue(el.token, { secretRef: "EMAIL" });
    expect(r.effect).toBe("confirmed");
    const sent = t.calls.at(-1)?.params as ActParams | undefined;
    expect(sent?.value).toBe("ada@example.com");
    expect(JSON.stringify(r)).not.toContain("ada@example.com");
    expect(r.evidence[0]).toMatchObject({ kind: "value", before: "<empty>", after: "[input:EMAIL]" });
    const missing = await computer.setValue(el.token, { secretRef: "NOPE" });
    expect(missing).toMatchObject({ effect: "refused", error: { kind: "secret_missing" } });
  });

  it("judges toggles and option selection from read-backs", async () => {
    const { t, computer } = setup();
    const box = await tokenOf(computer, "checkbox", "Subscribe to the newsletter");
    t.on("act", () => ({
      ok: true,
      route: "semantic",
      nativeRoute: "noop.already_in_state",
      before: { name: "x", states: ["checked"] },
      after: { name: "x", states: ["checked"] },
      globalBefore: G,
      globalAfter: G,
    }));
    const r = await computer.toggle(box.token, true);
    expect(r.effect).toBe("confirmed");
    expect(r.evidence[0]?.detail).toBe("already in the requested state");

    const combo = await tokenOf(computer, "combobox", "Plan");
    t.on("act", () => ({
      ok: true,
      route: "semantic",
      nativeRoute: "atspi.selection.select_child",
      before: { name: "Plan", states: [], selectedOption: "Free" },
      after: { name: "Plan", states: [], selectedOption: "Free" },
      globalBefore: G,
      globalAfter: G,
    }));
    const noop = await computer.selectOption(combo.token, "Pro");
    expect(noop.effect).toBe("suspected_noop");
  });

  it("maps host refusals and failures without retrying", async () => {
    const { t, computer } = setup();
    const el = await tokenOf(computer, "button", "Add item");
    t.failNext("act", { kind: "not_interactable", message: "button has no action" });
    const refused = await computer.press(el.token);
    expect(refused).toMatchObject({ effect: "refused", error: { kind: "not_interactable" } });
    const el2 = await tokenOf(computer, "button", "Add item");
    t.failNext("act", { kind: "timeout", message: "act timed out" });
    const timedOut = await computer.press(el2.token);
    expect(timedOut).toMatchObject({ effect: "unverifiable", error: { kind: "timeout" } });
    expect(await computer.press(el2.token)).toMatchObject({
      effect: "refused",
      error: { kind: "stale_token" },
    });
  });

  it("maps capture pixels and token centres to screen points for pointer input", async () => {
    const { t, computer } = setup();
    const inputs: InputParams[] = [];
    t.on("screenshot", () => ({
      data: "iVBORw0KGgo=",
      mimeType: "image/png",
      width: 640,
      height: 400,
      scale: 0.5,
    }));
    t.on("input", (p) => {
      inputs.push(p as InputParams);
      return { ok: true, route: "pointer", nativeRoute: "xtest.click", globalBefore: G, globalAfter: G };
    });
    const shot = await computer.screenshot({ x: 100, y: 50, width: 1280, height: 800 });
    if (!shot.ok) throw new Error(shot.error.message);
    await computer.click({ captureId: shot.value.capture.id, x: 10, y: 20 });
    expect(inputs[0]).toMatchObject({ op: "click", x: 120, y: 90 });
    const field = await tokenOf(computer, "textbox", "New item");
    const b = field.visibleBounds ?? field.bounds;
    if (!b) throw new Error("no bounds");
    const r = await computer.click({ token: field.token });
    expect(inputs[1]).toMatchObject({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    expect(r.effect).toBe("suspected_noop");
    const unknown = await computer.click({ captureId: "c99", x: 1, y: 1 });
    expect(unknown).toMatchObject({ effect: "refused", error: { kind: "stale_token" } });
  });

  it("refuses token clicks when bounds are untrusted (Wayland)", async () => {
    const t = new ScriptedTransport();
    t.on("observe", () => ({ ...gtkTestbedSnapshot(), snapshotId: "h1" }));
    const computer = new DesktopComputer({
      transport: t,
      hello: {
        ...X11_HELLO,
        platform: "linux-wayland",
        capabilities: { ...X11_HELLO.capabilities, boundsTrust: "none" },
      },
      surface: "wayland",
    });
    const el = await tokenOf(computer, "button", "Add item");
    expect(el.boundsTrust).toBe("none");
    const r = await computer.click({ token: el.token });
    expect(r).toMatchObject({ effect: "refused", error: { kind: "unsupported" } });
  });

  it("launches the configured app on the first open and app: targets later", async () => {
    const t = new ScriptedTransport();
    const launched: string[][] = [];
    t.on("launch", (p) => {
      launched.push(p.argv);
      return { pid: 42, windowTitle: "App" };
    });
    t.on("wait_idle", () => ({ waitedMs: 1, reason: "quiet" }));
    const computer = new DesktopComputer({
      transport: t,
      hello: X11_HELLO,
      surface: "x11",
      app: { argv: ["xterm"] },
    });
    expect((await computer.open("desktop:app")).ok).toBe(true);
    expect((await computer.open("desktop:app")).ok).toBe(true);
    expect((await computer.open('app:python3 "my app.py" --x')).ok).toBe(true);
    expect(launched).toEqual([["xterm"], ["python3", "my app.py", "--x"]]);
  });
});

describe("recording", () => {
  it("keeps the video, but discards it after a secret was typed into a visible field", async () => {
    const shared = mkdtempSync(join(tmpdir(), "gh-desktop-rec-"));
    const runDir = mkdtempSync(join(tmpdir(), "gh-desktop-run-"));
    try {
      const t = new ScriptedTransport();
      let file = "";
      t.on("observe", () => ({ ...gtkTestbedSnapshot(), snapshotId: "h1" }));
      t.on("record_start", (p) => {
        file = p.path.split("/").pop() ?? "";
        writeFileSync(join(shared, file), "video");
        return {};
      });
      t.on("record_stop", () => ({ files: [] }));
      t.on("act", (p) => ({
        ok: true,
        route: "semantic",
        nativeRoute: "x",
        before: { name: "Email", states: [], value: "" },
        after: { name: "Email", states: [], value: p.value ?? "" },
        globalBefore: G,
        globalAfter: G,
      }));
      const computer = new DesktopComputer({
        transport: t,
        hello: { ...X11_HELLO, capabilities: { ...X11_HELLO.capabilities, recording: true } },
        surface: "x11",
        secrets: new SecretsRegistry([["EMAIL", "ada@example.com"]]),
        shared: { hostPath: "/work", localPath: shared },
      });
      expect((await computer.startRecording(runDir)).ok).toBe(true);
      expect(await computer.stopRecording()).toMatchObject({
        ok: true,
        value: { files: [join(runDir, "video.mp4")] },
      });

      expect((await computer.startRecording(runDir)).ok).toBe(true);
      const el = await tokenOf(computer, "textbox", "Email");
      await computer.setValue(el.token, { secretRef: "EMAIL" });
      const stopped = await computer.stopRecording();
      expect(stopped.ok).toBe(false);
      expect(existsSync(join(shared, file))).toBe(false);
    } finally {
      rmSync(shared, { recursive: true, force: true });
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe("splitCommand", () => {
  it("splits like a shell for quotes and escapes", () => {
    expect(splitCommand(`gedit "a b.txt" 'c d' e\\ f ""`)).toEqual(["gedit", "a b.txt", "c d", "e f", ""]);
    expect(splitCommand("  ")).toEqual([]);
  });
});
