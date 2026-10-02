// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { StartRunInput } from "@ghosthand/protocol";
import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { createUiStore, RECENT_TASK_LIMIT, UI_STORAGE_KEY } from "./ui-store.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: StateStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { storage, values };
}

const input = StartRunInput.parse({
  source: {
    kind: "goal",
    goal: "Find the pricing page",
    startUrl: "https://example.com",
    allowOrigins: ["https://accounts.example.com"],
  },
  profile: "work",
  planner: "none",
  writer: "models",
  decision: "jev",
  showBrowser: false,
  unattended: true,
});

describe("UI drafts and recent tasks", () => {
  it("restores task fields, tab selections and unsaved setup drafts after a restart", () => {
    const { storage } = memoryStorage();
    const state = createUiStore(storage).getState();
    state.loadTask(input);
    state.patchComposer({ goal: "Still editing", startUrl: "https://" });
    state.selectSetupTab("browser");
    state.setForm("browserBehavior", {
      reduceAutomationMarkers: true,
      nativeWindow: true,
      inputPacing: "human",
      locale: "de-DE",
      timezoneId: "Still editing",
    });
    state.setForm("budget", { steps: "", seconds: "90", usd: "0.25" });
    state.setForm("profiles", { name: "new-profile", importName: "copy", chromeProfile: "Profile 2" });
    state.setForm("roleModels", { planner: { models: [] } });
    state.rememberRun("r1", input);
    const restored = createUiStore(storage).getState();
    expect(restored.composer).toMatchObject({
      source: "goal",
      goal: "Still editing",
      startUrl: "https://",
      profile: "work",
      planner: "none",
      writer: "models",
      showBrowser: false,
      unattended: true,
    });
    expect(restored.setupTab).toBe("browser");
    expect(restored.forms.browserBehavior?.timezoneId).toBe("Still editing");
    expect(restored.forms.budget?.steps).toBe("");
    expect(restored.forms.profiles?.chromeProfile).toBe("Profile 2");
    expect(restored.forms.roleModels?.planner?.models).toEqual([]);
    expect(restored.recentTasks[0]?.input).toEqual(input);
  });

  it("clears inputs independently of history and remembers the current task tab", () => {
    const { storage } = memoryStorage();
    const store = createUiStore(storage);
    store.getState().loadTask(input);
    store.getState().rememberRun("r1", input);
    store.getState().selectSetupTab("models");
    store.getState().clearComposer();
    expect(store.getState().composer).toMatchObject({
      source: "goal",
      goal: "",
      startUrl: "https://",
      unattended: false,
    });
    expect(store.getState().composer.profile).toBeUndefined();
    expect(store.getState().recentTasks).toHaveLength(1);
    expect(store.getState().setupTab).toBe("models");
    store.getState().loadTask(input);
    store.getState().clearRecentTasks();
    const restored = createUiStore(storage).getState();
    expect(restored.recentTasks).toEqual([]);
    expect(restored.composer.goal).toBe("Find the pricing page");
  });

  it("bounds recent submissions and replaces entries for the same run", () => {
    const { storage } = memoryStorage();
    const store = createUiStore(storage);
    for (let i = 0; i <= RECENT_TASK_LIMIT; i++) store.getState().rememberRun(`r${i}`, input);
    expect(store.getState().recentTasks).toHaveLength(RECENT_TASK_LIMIT);
    expect(store.getState().recentTasks.at(-1)?.runId).toBe("r1");
    store.getState().rememberRun("r1", input);
    expect(store.getState().recentTasks[0]?.runId).toBe("r1");
    expect(store.getState().recentTasks).toHaveLength(RECENT_TASK_LIMIT);
  });

  it("loads a testbed task without retaining unrelated goal fields", () => {
    const { storage } = memoryStorage();
    const store = createUiStore(storage);
    store.getState().loadTask(input);
    store
      .getState()
      .loadTask(
        StartRunInput.parse({ source: { kind: "testbed", taskId: "l1-login" }, decision: "heuristic" }),
      );
    expect(store.getState().composer).toMatchObject({
      source: "testbed",
      taskId: "l1-login",
      goal: "",
      allowOrigins: [],
      unattended: false,
    });
    expect(store.getState().composer.profile).toBeUndefined();
  });

  it("drops damaged fields and unknown values without losing valid drafts", () => {
    const { storage, values } = memoryStorage();
    values.set(
      UI_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          composer: { source: "invalid" },
          setupTab: "profiles",
          recentTasks: ["bad"],
          forms: {
            budget: { steps: "20", seconds: "", usd: "1" },
            profiles: 42,
            secretValue: "do-not-restore",
          },
          reset: "malicious",
          secretValue: "do-not-restore",
        },
      }),
    );
    const store = createUiStore(storage);
    expect(store.getState().setupTab).toBe("profiles");
    expect(store.getState().composer.source).toBe("testbed");
    expect(store.getState().forms.budget?.seconds).toBe("");
    expect(store.getState().forms.profiles).toBeUndefined();
    expect(store.getState().recentTasks).toEqual([]);
    expect(store.getState().reset).toBeTypeOf("function");
    expect(store.getState()).not.toHaveProperty("secretValue");
    store.getState().patchComposer({ goal: "Edited" });
    expect(values.get(UI_STORAGE_KEY)).not.toContain("do-not-restore");
    values.set(UI_STORAGE_KEY, "corrupt json");
    expect(createUiStore(storage).getState().composer.goal).toBe("");
  });

  it("caches credential names while omitting inline passwords, query credentials and unknown secret fields", () => {
    const { storage, values } = memoryStorage();
    const store = createUiStore(storage);
    store.getState().setForm("browserNetwork", {
      proxy: {
        enabled: true,
        server: "http://user:inline-secret@proxy.test",
        username: "PROXY_USER",
        password: "PROXY_PASSWORD",
      },
      solver: {
        enabled: true,
        endpoint: "https://solver.test?token=query-secret",
        origins: "https://app.test",
        bearer: "this is an actual secret",
        seconds: "60",
      },
    });
    expect(store.getState().forms.browserNetwork?.proxy.server).toContain("inline-secret");
    const saved = values.get(UI_STORAGE_KEY);
    expect(saved).toContain("PROXY_PASSWORD");
    expect(saved).not.toContain("inline-secret");
    expect(saved).not.toContain("query-secret");
    expect(saved).not.toContain("this is an actual secret");
    const restored = createUiStore(storage).getState().forms.browserNetwork;
    expect(restored?.proxy.server).toBe("");
    expect(restored?.solver.endpoint).toBe("");
    expect(restored?.proxy.password).toBe("PROXY_PASSWORD");
  });
});
