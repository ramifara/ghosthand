// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Every released testbed task. Released tasks are frozen: behavior changes bump `version`.
import type { TestbedTask } from "./define-task.ts";
import { l1FormValidation } from "./tasks/l1-form-validation.ts";
import { l1Login } from "./tasks/l1-login.ts";
import { l1LoginWrongPassword } from "./tasks/l1-login-wrong-password.ts";
import { l1UpdateProfile } from "./tasks/l1-update-profile.ts";

export const tasks: readonly TestbedTask[] = Object.freeze([
  l1Login,
  l1LoginWrongPassword,
  l1UpdateProfile,
  l1FormValidation,
]);

const byId = new Map(tasks.map((t) => [t.id, t]));
if (byId.size !== tasks.length) throw new Error("duplicate task id in the testbed registry");

export function getTask(id: string): TestbedTask | undefined {
  return byId.get(id);
}

export function listTaskIds(): string[] {
  return tasks.map((t) => t.id);
}
