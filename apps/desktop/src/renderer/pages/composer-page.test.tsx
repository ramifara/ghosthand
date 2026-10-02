// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// @vitest-environment jsdom
import { type GhostHandBridge, type IpcCommandName, MAX_TASK_GOAL_CHARS } from "@ghosthand/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveStore } from "../stores/live-store.ts";
import { useUiStore } from "../stores/ui-store.ts";
import { ComposerPage } from "./composer-page.tsx";

// jsdom has no ResizeObserver; Radix Switch measures its thumb with one.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const SETTINGS = {
  defaultProfile: "default",
  budget: { steps: 25, seconds: 180, usd: 0.25 },
  planner: "auto",
  writer: "auto",
  showBrowser: true,
  devPlumbingMode: false,
  devTestbed: false,
  chatgptSignIn: false,
  persistWithoutKeyring: false,
  roleBindings: {},
};

function installBridge(
  opts: {
    plumbing?: boolean;
    jevKey?: boolean;
    chatgpt?: boolean;
    failStart?: boolean;
    endBeforeReply?: boolean;
    packaged?: boolean;
    devTestbed?: boolean;
  } = {},
) {
  const calls: Array<{ command: IpcCommandName; input: unknown }> = [];
  const answers: Partial<Record<IpcCommandName, unknown>> = {
    "tasks.list": [
      { id: "l1-login", version: 1, level: 1, start: "/login", instruction: "Sign in as alice" },
      { id: "l2-orders-edit-status", version: 1, level: 2, start: "/orders", instruction: "Cancel ord_1012" },
    ],
    "profiles.list": [{ name: "work", sizeBytes: 10 }],
    "settings.get": {
      ...SETTINGS,
      devPlumbingMode: opts.plumbing ?? false,
      devTestbed: opts.devTestbed ?? false,
    },
    "app.info": {
      version: "0.0.0",
      platform: "linux",
      electron: "43.7.7",
      packaged: opts.packaged ?? false,
      secrets: { names: [], backend: "kwallet6", persistent: true },
      runsDir: "/runs",
      logsDir: "/logs",
    },
    "chatgpt.status": { enabled: true, signedIn: opts.chatgpt ?? false, pending: false, scopes: [] },
    "secrets.list": { names: opts.jevKey ? ["TYPESAFE_API_KEY"] : [], backend: "kwallet6", persistent: true },
    "runs.start": { runId: "20261001-120000-abcdef" },
  };
  const bridge: GhostHandBridge = {
    invoke: vi.fn(async (command: IpcCommandName, input?: unknown) => {
      calls.push({ command, input });
      if (command === "runs.start" && opts.failStart)
        return { ok: false as const, error: { kind: "unavailable", message: "Browser unavailable" } };
      if (command === "runs.start" && opts.endBeforeReply)
        useLiveStore.getState().ingest({
          kind: "status",
          runId: "20261001-120000-abcdef",
          status: "ended",
          outcome: "error",
          detail: "Browser failed immediately",
        });
      return { ok: true as const, value: answers[command] ?? null };
    }) as GhostHandBridge["invoke"],
    onEngineMessage: () => () => {},
    onPush: () => () => {},
    platform: "linux",
  };
  window.ghosthand = bridge;
  return calls;
}

function renderComposer(onStarted = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ComposerPage onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return onStarted;
}

describe("ComposerPage", () => {
  beforeEach(() => {
    useLiveStore.getState().reset();
    useLiveStore.getState().setEngine("ready");
    useUiStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
    delete window.ghosthand;
  });

  it("lists testbed tasks by level and starts the picked one", async () => {
    const calls = installBridge({ jevKey: true });
    const onStarted = renderComposer();
    const task = await screen.findByRole("radio", { name: /l1-login/ });
    expect(screen.getByText("Level 2")).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(task);
    expect((task as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("20261001-120000-abcdef"));
    expect(calls.find((c) => c.command === "runs.start")?.input).toEqual({
      source: { kind: "testbed", taskId: "l1-login" },
      decision: "jev",
      profile: "default",
      planner: "auto",
      writer: "auto",
      showBrowser: true,
      unattended: false,
    });
  });

  it("without a Jev key, only plumbing mode can start, and it is labelled", async () => {
    installBridge({ plumbing: true });
    renderComposer();
    fireEvent.click(await screen.findByRole("radio", { name: /l1-login/ }));
    expect(await screen.findByText(/Plumbing mode: a rule-based stand-in replaces Jev/)).toBeTruthy();
    const decision = screen.getByLabelText("Decision") as HTMLSelectElement;
    expect(decision.value).toBe("heuristic");
  });

  it("cannot start with no key and plumbing mode off", async () => {
    installBridge();
    renderComposer();
    fireEvent.click(await screen.findByRole("radio", { name: /l1-login/ }));
    expect(await screen.findByText(/Add a TypeSafe key/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists every blocker next to the button and clears them one by one", async () => {
    installBridge({ chatgpt: true });
    renderComposer();
    await screen.findByRole("radio", { name: /l1-login/ });
    fireEvent.click(screen.getByRole("tab", { name: /Goal on any site/ }));
    const blockers = () =>
      [...screen.getByRole("status", { name: "Before you can start" }).querySelectorAll("li")].map(
        (li) => li.textContent,
      );
    await waitFor(() => expect(blockers()).toHaveLength(3));
    expect(blockers()).toEqual([
      "Write a goal.",
      "Enter a start URL that begins with http:// or https://.",
      // A signed-in ChatGPT plan is not a decision model: say so instead of a bare "no key".
      "Your ChatGPT plan covers planning and writing, not the step decisions. Add a TypeSafe key in Setup → Providers to run with Jev.",
    ]);
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Find pricing" } });
    fireEvent.change(screen.getByLabelText("Start URL"), { target: { value: "https://example.com" } });
    expect(blockers()).toEqual([
      "Your ChatGPT plan covers planning and writing, not the step decisions. Add a TypeSafe key in Setup → Providers to run with Jev.",
    ]);
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => useLiveStore.setState({ runId: "r1", status: "starting" }));
    expect(blockers()[0]).toBe("A run is in progress. Stop it from the live view first.");
    act(() => {
      useLiveStore.setState({ status: "ended" });
      useLiveStore.getState().setEngine("crashed");
    });
    expect(blockers()[0]).toMatch(/^The engine stopped/);
  });

  it("an installed app hides the testbed until the developer switch turns it on", async () => {
    installBridge({ jevKey: true, packaged: true });
    renderComposer();
    await screen.findByLabelText("Goal");
    expect(screen.queryByRole("tab", { name: /Testbed task/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "Testbed task" })).toBeNull();
    // A draft that still points at the testbed (Run again on an old recording) says why it cannot run.
    act(() => useUiStore.getState().patchComposer({ source: "testbed", taskId: "l1-login" }));
    expect(screen.getByLabelText("Goal")).toBeTruthy();
    expect(screen.getByText(/belongs to the testbed, which this app hides/)).toBeTruthy();
    expect(screen.getByText("Write a goal.")).toBeTruthy();
    cleanup();
    delete window.ghosthand;
    installBridge({ jevKey: true, packaged: true, devTestbed: true });
    renderComposer();
    expect(await screen.findByRole("radio", { name: /l1-login/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Testbed task/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("takes a goal with a start URL and shows the ChatGPT plan label", async () => {
    const calls = installBridge({ jevKey: true, chatgpt: true });
    renderComposer();
    expect(await screen.findByText("Using ChatGPT plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Goal on any site/ }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Find the pricing page" } });
    fireEvent.change(screen.getByLabelText("Start URL"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(calls.some((c) => c.command === "runs.start")).toBe(true));
    expect(calls.find((c) => c.command === "runs.start")?.input).toMatchObject({
      source: { kind: "goal", goal: "Find the pricing page", startUrl: "https://example.com" },
    });
  });

  it("keeps the goal, selected tabs and run options after leaving and returning, and clears inputs explicitly", async () => {
    installBridge({ jevKey: true });
    renderComposer();
    await screen.findByRole("radio", { name: /l1-login/ });
    fireEvent.click(screen.getByRole("tab", { name: /Goal on any site/ }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Find pricing" } });
    fireEvent.change(screen.getByLabelText("Start URL"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByLabelText("Browser profile"), { target: { value: "work" } });
    fireEvent.change(screen.getByLabelText("Planner"), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("switch", { name: /Run without handover/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Testbed task/ }));
    fireEvent.click(screen.getByRole("radio", { name: /l1-login/ }));
    cleanup();
    renderComposer();
    expect(((await screen.findByRole("radio", { name: /l1-login/ })) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("tab", { name: /Testbed task/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /Goal on any site/ }));
    expect((screen.getByLabelText("Goal") as HTMLInputElement).value).toBe("Find pricing");
    expect((screen.getByLabelText("Browser profile") as HTMLSelectElement).value).toBe("work");
    expect((screen.getByLabelText("Planner") as HTMLSelectElement).value).toBe("none");
    expect(screen.getByRole("switch", { name: /Run without handover/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear inputs" }));
    expect((screen.getByLabelText("Goal") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Start URL") as HTMLInputElement).value).toBe("https://");
    expect((screen.getByLabelText("Planner") as HTMLSelectElement).value).toBe("auto");
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("loads a recent submission without running it, then sends the same fields on Start run", async () => {
    const calls = installBridge({ jevKey: true });
    const onStarted = renderComposer();
    await screen.findByRole("radio", { name: /l1-login/ });
    fireEvent.click(screen.getByRole("tab", { name: /Goal on any site/ }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Find pricing" } });
    fireEvent.change(screen.getByLabelText("Start URL"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByLabelText("Browser profile"), { target: { value: "work" } });
    fireEvent.change(screen.getByLabelText("Planner"), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const first = calls.find((call) => call.command === "runs.start")?.input;
    cleanup();
    useLiveStore.setState({ status: "ended" });
    renderComposer();
    fireEvent.click(await screen.findByRole("button", { name: "Clear inputs" }));
    fireEvent.change(screen.getByLabelText("Recent tasks"), { target: { value: "20261001-120000-abcdef" } });
    expect((screen.getByLabelText("Goal") as HTMLInputElement).value).toBe("Find pricing");
    expect(calls.filter((call) => call.command === "runs.start")).toHaveLength(1);
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(calls.filter((call) => call.command === "runs.start")).toHaveLength(2));
    expect(calls.filter((call) => call.command === "runs.start")[1]?.input).toEqual(first);
  });

  it("submits and reloads a long goal intact, and keeps an oversized draft for editing", async () => {
    const calls = installBridge({ jevKey: true });
    const onStarted = renderComposer();
    await screen.findByRole("radio", { name: /l1-login/ });
    fireEvent.click(screen.getByRole("tab", { name: /Goal on any site/ }));
    const goal = "A detailed task brief. ".repeat(300);
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: goal } });
    fireEvent.change(screen.getByLabelText("Start URL"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(calls.find((call) => call.command === "runs.start")?.input).toMatchObject({
      source: { goal: goal.trim() },
    });
    cleanup();
    useLiveStore.setState({ status: "ended" });
    renderComposer();
    fireEvent.click(await screen.findByRole("button", { name: "Clear inputs" }));
    fireEvent.change(screen.getByLabelText("Recent tasks"), { target: { value: "20261001-120000-abcdef" } });
    expect((screen.getByLabelText("Goal") as HTMLTextAreaElement).value).toBe(goal.trim());
    const oversized = "x".repeat(MAX_TASK_GOAL_CHARS + 1);
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: oversized } });
    expect((screen.getByLabelText("Goal") as HTMLTextAreaElement).value).toBe(oversized);
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Shorten the goal");
  });

  it("preserves a run that ended before the start reply, allowing an immediate rerun", async () => {
    installBridge({ jevKey: true, endBeforeReply: true });
    const onStarted = renderComposer();
    fireEvent.click(await screen.findByRole("radio", { name: /l1-login/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(useLiveStore.getState().status).toBe("ended");
    expect(useLiveStore.getState().detail).toBe("Browser failed immediately");
    expect((screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the draft when startup fails and does not add an unstarted run to recent tasks", async () => {
    const calls = installBridge({ jevKey: true, failStart: true });
    renderComposer();
    fireEvent.click(await screen.findByRole("radio", { name: /l1-login/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The run did not start: Browser unavailable");
    expect(calls.filter((call) => call.command === "runs.start")).toHaveLength(1);
    expect(useUiStore.getState().composer.taskId).toBe("l1-login");
    expect(useUiStore.getState().recentTasks).toEqual([]);
  });
});
