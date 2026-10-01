// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Typed client for the testbed control API on :4401. Node-compatible (fetch only).
import { err, ok, type Result } from "@ghosthand/protocol";
import type { z } from "zod";
import {
  ClockResponse,
  MailResponse,
  OracleResult,
  type ResetRequest,
  ResetResponse,
  SeedResponse,
  SessionResponse,
  TestbedState,
} from "./control-schemas.ts";
import type { TestbedTask } from "./define-task.ts";
import { CONTROL_ORIGIN } from "./fixtures.ts";

export type ControlError =
  | { kind: "network"; message: string }
  | { kind: "http"; status: number; message: string }
  | { kind: "invalid_response"; message: string };

export interface PreparedTask {
  reset: ResetResponse;
  /** Session cookie for `setup.login`, to be added to the agent's browser context. */
  cookie?: SessionResponse["cookie"];
}

export interface ControlClient {
  reset(request?: ResetRequest): Promise<Result<ResetResponse, ControlError>>;
  seed(name: string): Promise<Result<SeedResponse, ControlError>>;
  setClock(iso: string): Promise<Result<ClockResponse, ControlError>>;
  oracle(taskId: string, opts?: { answer?: string }): Promise<Result<OracleResult, ControlError>>;
  mail(): Promise<Result<MailResponse, ControlError>>;
  /** The full oracle snapshot (users, sessions, audit log, mail). For harness checks and debugging. */
  state(): Promise<Result<TestbedState, ControlError>>;
  createSession(email: string): Promise<Result<SessionResponse, ControlError>>;
  /** Reset, apply named seeds and sign in per `task.setup`. */
  prepare(task: TestbedTask): Promise<Result<PreparedTask, ControlError>>;
}

export interface ControlClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export function createControlClient(options: ControlClientOptions = {}): ControlClient {
  const baseUrl = (options.baseUrl ?? CONTROL_ORIGIN).replace(/\/$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;

  async function call<S extends z.ZodType>(
    schema: S,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Result<z.infer<S>, ControlError>> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch (e) {
      return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
    }
    const text = await res.text();
    if (!res.ok) return err({ kind: "http", status: res.status, message: text.slice(0, 500) });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return err({ kind: "invalid_response", message: `not JSON: ${text.slice(0, 200)}` });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return err({ kind: "invalid_response", message: parsed.error.message });
    return ok(parsed.data);
  }

  const client: ControlClient = {
    reset: (request = {}) => call(ResetResponse, "POST", "/reset", request),
    seed: (name) => call(SeedResponse, "POST", `/seed/${encodeURIComponent(name)}`, {}),
    setClock: (iso) => call(ClockResponse, "POST", "/clock", { iso }),
    oracle: (taskId, opts = {}) => {
      const query = opts.answer === undefined ? "" : `?answer=${encodeURIComponent(opts.answer)}`;
      return call(OracleResult, "GET", `/oracle/${encodeURIComponent(taskId)}${query}`);
    },
    mail: () => call(MailResponse, "GET", "/mail"),
    state: () => call(TestbedState, "GET", "/state"),
    createSession: (email) => call(SessionResponse, "POST", "/session", { email }),
    async prepare(task) {
      const reset = await client.reset({ seed: task.setup.seed, variant: task.setup.variant });
      if (!reset.ok) return reset;
      for (const name of task.setup.seeds) {
        const seeded = await client.seed(name);
        if (!seeded.ok) return seeded;
      }
      if (task.setup.login === undefined) return ok({ reset: reset.value });
      const session = await client.createSession(task.setup.login);
      if (!session.ok) return session;
      return ok({ reset: reset.value, cookie: session.value.cookie });
    },
  };
  return client;
}
