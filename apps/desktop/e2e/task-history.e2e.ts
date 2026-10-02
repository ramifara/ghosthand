// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskSpec } from "@ghosthand/protocol";
import { createRunRecorder, openRunIndex } from "@ghosthand/recorder";
import { expect, test } from "@playwright/test";
import { launchApp, skipReason } from "./launch-app.ts";

const reason = skipReason();
test.skip(reason !== undefined, reason ?? "");

test("keeps drafts and selected tabs across navigation, reload and app restart, with explicit resets", async () => {
  let launched = await launchApp();
  const userData = launched.userData;
  try {
    let page = launched.page;
    await page.getByRole("tab", { name: "Goal on any site" }).click();
    const brief = "Find the pricing page and report the annual price. ".repeat(100);
    await page.getByLabel("Goal", { exact: true }).fill(brief);
    await page.getByLabel("Start URL", { exact: true }).fill("https://example.com/pricing");
    await page.getByLabel("Planner", { exact: true }).selectOption("none");
    await page.getByRole("link", { name: "Setup" }).click();
    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await page.getByLabel("New profile", { exact: true }).fill("draft-profile");
    await page.getByLabel("New name", { exact: true }).fill("draft-import");
    await page.getByRole("tab", { name: "Browser", exact: true }).click();
    await page.getByLabel("Timezone", { exact: true }).fill("Mars/Olympus");
    await page.getByLabel("Proxy server", { exact: true }).fill("http://draft-proxy.test:8080");
    await page.getByRole("link", { name: "Task", exact: true }).click();
    await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(brief);
    await expect(page.getByLabel("Planner", { exact: true })).toHaveValue("none");
    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("tab", { name: "Browser", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("Mars/Olympus");
    await page.reload();
    await expect(page.getByLabel("Proxy server", { exact: true })).toHaveValue(
      "http://draft-proxy.test:8080",
    );
    await launched.app.close();
    launched = await launchApp({}, { userData });
    page = launched.page;
    await expect(page.getByRole("tab", { name: "Goal on any site" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(brief);
    await expect(page.getByLabel("Start URL", { exact: true })).toHaveValue("https://example.com/pricing");
    await page.getByRole("button", { name: "Clear inputs" }).click();
    await expect(page.getByLabel("Goal", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Start URL", { exact: true })).toHaveValue("https://");
    await expect(page.getByLabel("Planner", { exact: true })).toHaveValue("auto");
    await page.getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("tab", { name: "Browser", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("Mars/Olympus");
    await page.getByRole("button", { name: "Reset browser behavior fields" }).click();
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Proxy server", { exact: true })).toHaveValue(
      "http://draft-proxy.test:8080",
    );
    await page.getByRole("button", { name: "Reset proxy and FlareSolverr fields" }).click();
    await expect(page.getByLabel("Proxy server", { exact: true })).toHaveValue("");
    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await expect(page.getByLabel("New profile", { exact: true })).toHaveValue("draft-profile");
    await expect(page.getByLabel("New name", { exact: true })).toHaveValue("draft-import");
    await page.getByRole("button", { name: "Clear profile inputs" }).click();
    await expect(page.getByLabel("New profile", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("New name", { exact: true })).toHaveValue("");
  } finally {
    await launched.app.close();
  }
});

test("loads an older recorded task from Runs and Replay without starting a run", async () => {
  const userData = mkdtempSync(join(tmpdir(), "ghosthand-history-e2e-"));
  const runsDir = join(userData, "runs");
  const index = openRunIndex(runsDir);
  if (!index.ok) throw new Error(index.error.message);
  const recorder = createRunRecorder({
    runsDir,
    runId: "history-goal",
    index: index.value,
    redact: (text) => text,
  });
  if (!recorder.ok) throw new Error(recorder.error.message);
  const recorded = recorder.value.emit({
    type: "run.start",
    task: TaskSpec.parse({
      id: "adhoc",
      instruction: "Find the pricing page",
      startUrl: "https://example.com/pricing",
      allowOrigins: ["https://accounts.example.com"],
    }),
    gitSha: "fixture",
    decisionModel: "heuristic",
    surface: "chrome 151 / profile work",
  });
  if (!recorded.ok) throw new Error(recorded.error.message);
  const finished = recorder.value.finish({ outcome: "aborted", reason: "Fixture recording" });
  if (!finished.ok) throw new Error(finished.error.message);
  index.value.close();
  const { app, page } = await launchApp({}, { userData });
  try {
    await page.getByRole("link", { name: "Runs", exact: true }).click();
    await page.getByRole("button", { name: "Use task from run history-goal" }).click();
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    await expect(page.getByLabel("Goal", { exact: true })).toHaveValue("Find the pricing page");
    await expect(page.getByLabel("Start URL", { exact: true })).toHaveValue("https://example.com/pricing");
    await expect(page.getByLabel("Browser profile", { exact: true })).toHaveValue("work");
    await expect(page.getByRole("button", { name: "Start run" })).toBeDisabled();
    await page.getByRole("button", { name: "Clear inputs" }).click();
    await page.getByRole("link", { name: "Runs", exact: true }).click();
    await page.getByRole("button", { name: "Open run history-goal" }).click();
    await page.getByRole("button", { name: "Run again from run history-goal" }).click();
    await expect(page.getByLabel("Goal", { exact: true })).toHaveValue("Find the pricing page");
    const active = await page.evaluate(async () => {
      const bridge = (
        globalThis as unknown as { ghosthand: { invoke(command: string, input: unknown): Promise<unknown> } }
      ).ghosthand;
      return bridge.invoke("runs.active", {});
    });
    expect(active).toMatchObject({ ok: true, value: null });
  } finally {
    await app.close();
  }
});
