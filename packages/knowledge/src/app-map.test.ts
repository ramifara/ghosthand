// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { fakeElement, type ScreenFingerprint } from "@ghosthand/core";
import { RunEvent } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { appOf } from "./app-map.ts";
import { openKnowledge } from "./knowledge.ts";

const fp = (key: string, path: string): ScreenFingerprint => ({
  key,
  urlPattern: `http://a.test${path}`,
  landmarks: [`h:${key}`],
  controls: [`button:${key}`],
});

const t = (from: string, name: string, to: string, ok = true) => ({
  from,
  action: "press",
  target: { stableId: `link|${name}`, role: "link", name },
  to,
  ok,
  at: 1,
});

describe("AppMap", () => {
  it("records screens, elements and transitions, and finds the shortest working path", () => {
    const k = openKnowledge({ path: ":memory:" });
    if (!k.ok) throw new Error(k.error.message);
    const map = k.value.appMap;
    const app = appOf("http://a.test/home");
    const r = map.record(
      app,
      [
        {
          fingerprint: fp("home", "/"),
          title: "Home",
          elements: [fakeElement("e1", { role: "link", name: "Orders", automationId: "nav.orders" })],
          at: 1,
        },
        { fingerprint: fp("orders", "/orders"), title: "Orders", elements: [], at: 2 },
      ],
      [
        t("home", "Orders", "orders"),
        t("orders", "Order 7", "order"),
        t("home", "Broken", "order", false),
        t("order", "Back", "home"),
      ],
    );
    expect(r.ok).toBe(true);
    const screens = map.screens(app);
    expect(screens.ok ? screens.value.map((s) => s.key).sort() : []).toEqual(["home", "orders"]);
    const els = map.elements(app, "home");
    expect(els.ok && els.value[0]).toMatchObject({
      name: "Orders",
      automationId: "nav.orders",
      source: "runtime",
    });
    expect(map.markSourceTestids(app, ["nav.orders"]).ok).toBe(true);
    const marked = map.elements(app, "home");
    expect(marked.ok && marked.value[0]?.source).toBe("both");

    const path = map.findPath(app, "home", "order");
    expect(path.ok && path.value?.map((p) => p.target.name)).toEqual(["Orders", "Order 7"]);
    expect(map.findPath(app, "home", "nowhere").ok && map.findPath(app, "home", "nowhere")).toMatchObject({
      value: undefined,
    });
    expect(map.findPath(app, "home", "home")).toEqual({ ok: true, value: [] });
    k.value.close();
  });

  it("derives transitions from a run's events", () => {
    const k = openKnowledge({ path: ":memory:" });
    if (!k.ok) throw new Error(k.error.message);
    const s = k.value.session("http://a.test/");
    const base = { runId: "r", t: 0 };
    const events = [
      {
        ...base,
        seq: 0,
        type: "observe",
        step: 1,
        snapshotId: "s1",
        elementCount: 1,
        tokenEstimate: 1,
        screen: "home",
      },
      {
        ...base,
        seq: 1,
        type: "action",
        step: 1,
        action: { type: "press", token: "e1" },
        target: { stableId: "link|Orders", role: "link", name: "Orders" },
        mode: "B",
      },
      {
        ...base,
        seq: 2,
        type: "effect",
        step: 1,
        result: {
          effect: "confirmed",
          route: "semantic",
          evidence: [],
          invalidatedSnapshots: [],
          durationMs: 1,
        },
      },
      {
        ...base,
        seq: 3,
        type: "observe",
        step: 2,
        snapshotId: "s2",
        elementCount: 1,
        tokenEstimate: 1,
        screen: "orders",
      },
    ].map((e) => RunEvent.parse(e));
    expect(s.transitions(events)).toEqual([
      expect.objectContaining({ from: "home", to: "orders", ok: true, action: "press" }),
    ]);
    k.value.close();
  });
});
