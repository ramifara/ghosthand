// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserNetwork } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "./settings-store.ts";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "gh-settings-")), "settings.json");

describe("SettingsStore", () => {
  it("starts with defaults and persists patches", () => {
    const file = tmpFile();
    const s = new SettingsStore(file);
    expect(s.get().devPlumbingMode).toBe(false);
    s.patch({ devPlumbingMode: true, budget: { steps: 10, seconds: 60, usd: 0.1 } });
    const again = new SettingsStore(file);
    expect(again.get().devPlumbingMode).toBe(true);
    expect(again.get().budget.steps).toBe(10);
    expect(JSON.parse(readFileSync(file, "utf8")).devPlumbingMode).toBe(true);
  });

  it("keeps valid fields from a damaged file and drops the rest", () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ showBrowser: false, defaultProfile: "Bad Name", unknown: 1 }));
    const s = new SettingsStore(file);
    expect(s.get().showBrowser).toBe(false);
    expect(s.get().defaultProfile).toBe("default");
  });

  it("survives a corrupt file", () => {
    const file = tmpFile();
    writeFileSync(file, "{nope");
    expect(new SettingsStore(file).get().planner).toBe("auto");
  });
  it("keeps browser behavior after a restart and adds defaults to older settings", () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ defaultProfile: "work", showBrowser: false }));
    const store = new SettingsStore(file);
    expect(store.get().browserBehavior.inputPacing).toBe("instant");
    store.patch({
      browserNetwork: BrowserNetwork.parse({
        proxy: {
          enabled: true,
          server: "http://proxy.test:8080",
          usernameSecretRef: "PROXY_USER",
          passwordSecretRef: "PROXY_PASSWORD",
        },
        flaresolverr: {
          enabled: true,
          endpoint: "http://solver.test:8191",
          origins: ["https://app.test"],
          bearerSecretRef: "SOLVER_TOKEN",
        },
      }),
      browserBehavior: {
        reduceAutomationMarkers: true,
        nativeWindow: true,
        inputPacing: "human",
        locale: "de-DE",
        timezoneId: "Europe/Berlin",
      },
    });
    const again = new SettingsStore(file);
    expect(again.get().defaultProfile).toBe("work");
    expect(again.get().browserBehavior).toEqual(store.get().browserBehavior);
    expect(again.get().browserNetwork).toEqual(store.get().browserNetwork);
    expect(readFileSync(file, "utf8")).toContain("PROXY_PASSWORD");
  });
});
