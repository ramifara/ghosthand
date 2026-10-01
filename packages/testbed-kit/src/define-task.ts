// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Task definitions: what the agent is asked to do, where it starts, and the oracle that decides success.
import { Budget, DEFAULT_BUDGET, DoneWhen } from "@ghosthand/protocol";
import type { OracleResult, TestbedState } from "./control-schemas.ts";
import { type FixtureSecretName, isFixtureSecretName } from "./fixture-secrets.ts";
import { Variant, type VariantInput } from "./variant.ts";

export type TaskLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface TaskSetup {
  seed: number;
  variant?: VariantInput;
  /** Named seeds applied after the reset, in order (`POST /seed/:name`). */
  seeds?: readonly string[];
  /** Email of a user the harness signs in before the agent starts (`POST /session`). */
  login?: string;
}

export interface OracleContext {
  /** The agent's final answer, for tasks that ask it to report something. */
  answer?: string;
}

/** Pure check over the DB snapshot. Runs inside the testbed server behind `GET /oracle/:task`. */
export type Oracle = (state: TestbedState, ctx: OracleContext) => OracleResult;

export interface TaskDefinitionInput {
  id: string;
  version: number;
  level: TaskLevel;
  setup: TaskSetup;
  /** Path on the testbed app the agent starts from. */
  start: string;
  /** What the agent is told. Secrets appear only as `[input:NAME]`. */
  instruction: string;
  oracle: Oracle;
  /** Forbidden outcomes, phrased for the effect gate. */
  forbidden: readonly string[];
  budget?: Partial<Budget>;
  secrets: readonly FixtureSecretName[];
  /** Deterministic completion predicates for the step loop (protocol `DoneWhen`). */
  doneWhen?: DoneWhen;
}

export interface TestbedTask {
  readonly id: string;
  readonly version: number;
  readonly level: TaskLevel;
  readonly setup: Readonly<Required<Omit<TaskSetup, "login" | "variant">>> & {
    readonly variant: Variant;
    readonly login?: string;
  };
  readonly start: string;
  readonly instruction: string;
  readonly oracle: Oracle;
  readonly forbidden: readonly string[];
  readonly budget: Budget;
  readonly secrets: readonly FixtureSecretName[];
  readonly doneWhen: DoneWhen;
}

const ID_PATTERN = /^l\d-[a-z0-9-]+$/;

/** Validates and freezes a task. Throws on malformed definitions: they are programmer errors. */
export function defineTask(input: TaskDefinitionInput): TestbedTask {
  if (!ID_PATTERN.test(input.id)) throw new Error(`task id "${input.id}" must look like "l1-some-name"`);
  if (!input.id.startsWith(`l${input.level}-`))
    throw new Error(`task ${input.id}: id prefix does not match level ${input.level}`);
  if (!Number.isInteger(input.version) || input.version < 1)
    throw new Error(`task ${input.id}: version must be a positive integer`);
  if (!input.start.startsWith("/")) throw new Error(`task ${input.id}: start must be a path`);
  for (const name of input.secrets) {
    if (!isFixtureSecretName(name)) throw new Error(`task ${input.id}: unknown secret ${name}`);
  }
  for (const m of input.instruction.matchAll(/\[input:([A-Z0-9_]+)\]/g)) {
    const name = m[1] ?? "";
    if (!input.secrets.includes(name as FixtureSecretName))
      throw new Error(`task ${input.id}: instruction uses [input:${name}] but secrets does not list it`);
  }
  const doneWhen = DoneWhen.parse(input.doneWhen ?? { all: [{ kind: "oracle", taskId: input.id }] });
  const budget = Budget.parse({ ...DEFAULT_BUDGET, ...input.budget });
  const setup = {
    seed: input.setup.seed,
    variant: Variant.parse(input.setup.variant ?? {}),
    seeds: [...(input.setup.seeds ?? [])],
    ...(input.setup.login === undefined ? {} : { login: input.setup.login }),
  };
  return Object.freeze({
    id: input.id,
    version: input.version,
    level: input.level,
    setup: Object.freeze(setup),
    start: input.start,
    instruction: input.instruction,
    oracle: input.oracle,
    forbidden: Object.freeze([...input.forbidden]),
    budget,
    secrets: Object.freeze([...input.secrets]),
    doneWhen,
  });
}
