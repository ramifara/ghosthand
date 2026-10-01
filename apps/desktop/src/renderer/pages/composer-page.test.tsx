// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// @vitest-environment jsdom
import type { GhostHandBridge, IpcCommandName } from "@ghosthand/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveStore } from "../stores/live-store.ts";
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
  chatgptSignIn: false,
  persistWithoutKeyring: false,
  roleBindings: {},
};

function installBridge(opts: { plumbing?: boolean; jevKey?: boolean; chatgpt?: boolean } = {}) {
  const calls: Array<{ command: IpcCommandName; input: unknown }> = [];
  const answers: Partial<Record<IpcCommandName, unknown>> = {
    "tasks.list": [
      { id: "l1-login", version: 1, level: 1, start: "/login", instruction: "Sign in as alice" },
      { id: "l2-orders-edit-status", version: 1, level: 2, start: "/orders", instruction: "Cancel ord_1012" },
    ],
    "profiles.list": [{ name: "work", sizeBytes: 10 }],
    "settings.get": { ...SETTINGS, devPlumbingMode: opts.plumbing ?? false },
    "chatgpt.status": { enabled: true, signedIn: opts.chatgpt ?? false, pending: false, scopes: [] },
    "secrets.list": { names: opts.jevKey ? ["TYPESAFE_API_KEY"] : [], backend: "kwallet6", persistent: true },
    "runs.start": { runId: "20261001-120000-abcdef" },
  };
  const bridge: GhostHandBridge = {
    invoke: vi.fn(async (command: IpcCommandName, input?: unknown) => {
      calls.push({ command, input });
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
  beforeEach(() => useLiveStore.getState().reset());
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
});
