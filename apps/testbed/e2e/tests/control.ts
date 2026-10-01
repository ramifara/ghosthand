// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Control-API helpers shared by the L2/L3 smoke tests.
import {
  APP_ORIGIN,
  type ControlClient,
  createControlClient,
  type OracleResult,
  type TestbedTask,
} from "@ghosthand/testbed-kit";
import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";

export const control: ControlClient = createControlClient();

export function unwrap<T>(res: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!res.ok) throw new Error(`control API call failed: ${JSON.stringify(res.error)}`);
  return res.value;
}

export async function oracle(taskId: string, answer?: string): Promise<OracleResult> {
  return unwrap(await control.oracle(taskId, answer === undefined ? {} : { answer }));
}

/** Resets for the task, signs the browser in when the task starts signed in, and opens `task.start`. */
export async function prepare(task: TestbedTask, context: BrowserContext, page: Page): Promise<void> {
  const prepared = unwrap(await control.prepare(task));
  if (prepared.cookie) {
    await context.addCookies([{ ...prepared.cookie, url: APP_ORIGIN, httpOnly: true, sameSite: "Lax" }]);
  }
  await page.goto(task.start);
}

/** Asserts the oracle fails now; call before acting. */
export async function expectOracleFails(taskId: string, answer?: string): Promise<void> {
  expect((await oracle(taskId, answer)).pass).toBe(false);
}

export async function expectOraclePasses(taskId: string, answer?: string): Promise<void> {
  const result = await oracle(taskId, answer);
  expect(result, JSON.stringify(result.checks)).toMatchObject({ pass: true });
}

/** The table row whose row header is `orderId`. */
export function orderRow(page: Page, orderId: string): Locator {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: orderId, exact: true }) });
}

/** The table row for a customer and date, the way a person scans for it. */
export function orderRowFor(page: Page, customer: string, placedOn: string): Locator {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: customer, exact: true }) })
    .filter({ has: page.getByRole("cell", { name: placedOn, exact: true }) });
}
