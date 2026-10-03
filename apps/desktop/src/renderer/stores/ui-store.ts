// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Local UI drafts and recent submissions. Credential values never belong in this store.
import {
  BrowserBehavior,
  DecisionChoice,
  Guidance,
  PlannerChoice,
  StartRunInput,
  WriterChoice,
} from "@ghosthand/protocol";
import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export const UI_STORAGE_KEY = "ghosthand-ui-v1";
export const RECENT_TASK_LIMIT = 30;
export const SetupTab = z.enum([
  "providers",
  "models",
  "profiles",
  "browser",
  "budgets",
  "downloads",
  "developer",
]);

export const ComposerDraft = z.object({
  source: z.enum(["testbed", "goal"]).default("testbed"),
  taskId: z.string().optional(),
  goal: z.string().default(""),
  startUrl: z.string().default("https://"),
  allowOrigins: z.array(z.string()).default([]),
  profile: z.string().optional(),
  planner: PlannerChoice.optional(),
  writer: WriterChoice.optional(),
  guidance: Guidance.optional(),
  decision: DecisionChoice.optional(),
  showBrowser: z.boolean().optional(),
  unattended: z.boolean().default(false),
});
export type ComposerDraft = z.infer<typeof ComposerDraft>;

export const BrowserBehaviorDraft = BrowserBehavior.omit({ locale: true, timezoneId: true }).extend({
  locale: z.string().default(""),
  timezoneId: z.string().default(""),
});
export const BrowserNetworkDraft = z.object({
  proxy: z.object({ enabled: z.boolean(), server: z.string(), username: z.string(), password: z.string() }),
  solver: z.object({
    enabled: z.boolean(),
    endpoint: z.string(),
    origins: z.string(),
    bearer: z.string(),
    seconds: z.string(),
  }),
});
const FormDrafts = z.object({
  browserBehavior: BrowserBehaviorDraft.optional().catch(undefined),
  browserNetwork: BrowserNetworkDraft.optional().catch(undefined),
  profiles: z
    .object({ name: z.string(), importName: z.string(), chromeProfile: z.string() })
    .optional()
    .catch(undefined),
  budget: z.object({ steps: z.string(), seconds: z.string(), usd: z.string() }).optional().catch(undefined),
  // Model selections can be empty while editing, before the IPC contract validates a save.
  roleModels: z
    .partialRecord(
      z.enum(["planner", "writer", "vision_reviewer", "vision_grounder", "judge"]),
      z.object({
        models: z.array(z.string()),
        reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
      }),
    )
    .optional()
    .catch(undefined),
  providerName: z.string().optional().catch(undefined),
});
type FormDrafts = z.infer<typeof FormDrafts>;
type FormKey = keyof FormDrafts;
const RecentTask = z.object({ runId: z.string(), startedAt: z.number(), input: StartRunInput });
export type RecentTask = z.infer<typeof RecentTask>;
const UiData = z.object({
  composer: ComposerDraft.catch(() => ComposerDraft.parse({})).prefault({}),
  setupTab: SetupTab.catch("providers").default("providers"),
  recentTasks: z.array(RecentTask).max(RECENT_TASK_LIMIT).catch([]).default([]),
  forms: FormDrafts.catch({}).prefault({}),
});
type UiData = z.infer<typeof UiData>;

interface UiState extends UiData {
  patchComposer(patch: Partial<ComposerDraft>): void;
  clearComposer(): void;
  loadTask(input: StartRunInput): void;
  rememberRun(runId: string, input: StartRunInput): void;
  clearRecentTasks(): void;
  selectSetupTab(tab: string): void;
  setForm<K extends FormKey>(key: K, value: NonNullable<FormDrafts[K]>): void;
  clearForm(key: FormKey): void;
  reset(): void;
}

const browserStorage: StateStorage = {
  getItem(name) {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* Keep the draft in memory if storage is unavailable. */
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      /* Storage may be unavailable. */
    }
  },
};

/** Inline passwords and invalid credential names must not enter cached connection drafts. */
function cacheNetwork(draft: z.infer<typeof BrowserNetworkDraft>): z.infer<typeof BrowserNetworkDraft> {
  const server = (value: string) => {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash) return "";
    } catch {
      if (/\/\/[^/]*@/.test(value)) return "";
    }
    return value;
  };
  const name = (value: string) => (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value) ? value : "");
  return {
    proxy: {
      ...draft.proxy,
      server: server(draft.proxy.server),
      username: name(draft.proxy.username),
      password: name(draft.proxy.password),
    },
    solver: { ...draft.solver, endpoint: server(draft.solver.endpoint), bearer: name(draft.solver.bearer) },
  };
}

export function createUiStore(storage: StateStorage = browserStorage) {
  return create<UiState>()(
    persist(
      (set, get) => ({
        ...UiData.parse({}),
        patchComposer: (patch) => set({ composer: ComposerDraft.parse({ ...get().composer, ...patch }) }),
        clearComposer: () => set({ composer: ComposerDraft.parse({ source: get().composer.source }) }),
        loadTask: (input) => {
          const parsed = StartRunInput.parse(input);
          const { source, ...options } = parsed;
          set({
            composer: ComposerDraft.parse({
              ...options,
              source: source.kind,
              ...(source.kind === "testbed"
                ? { taskId: source.taskId }
                : { goal: source.goal, startUrl: source.startUrl, allowOrigins: source.allowOrigins }),
            }),
          });
        },
        rememberRun: (runId, input) =>
          set({
            recentTasks: [
              { runId, startedAt: Date.now(), input: StartRunInput.parse(input) },
              ...get().recentTasks.filter((task) => task.runId !== runId),
            ].slice(0, RECENT_TASK_LIMIT),
          }),
        clearRecentTasks: () => set({ recentTasks: [] }),
        selectSetupTab: (tab) => set({ setupTab: SetupTab.parse(tab) }),
        setForm: (key, value) => set({ forms: FormDrafts.parse({ ...get().forms, [key]: value }) }),
        clearForm: (key) => {
          const forms = { ...get().forms };
          delete forms[key];
          set({ forms });
        },
        reset: () => set(UiData.parse({})),
      }),
      {
        name: UI_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage<UiData>(() => storage),
        partialize: ({ composer, setupTab, recentTasks, forms }) => ({
          composer,
          setupTab,
          recentTasks,
          forms: {
            ...forms,
            ...(forms.browserNetwork ? { browserNetwork: cacheNetwork(forms.browserNetwork) } : {}),
          },
        }),
        merge: (saved, current) => ({ ...current, ...UiData.parse(saved ?? {}) }),
      },
    ),
  );
}

export const useUiStore = createUiStore();
