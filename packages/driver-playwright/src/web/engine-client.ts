// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Registers the in-page `ghosthand` selector engine and runs commands through it (one protocol call
// per frame). Playwright only installs selector engines in documents created after registration, so
// register before opening pages (createWebComputer and launchWebComputer do this for you).
import type { ComputerError, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { Frame } from "playwright-core";
import { selectors } from "playwright-core";
import type { z } from "zod";
import { createGhosthandEngine } from "./in-page/ghosthand-engine.ts";
import type { EngineCommand } from "./in-page/page-types.ts";

export const ENGINE_NAME = "ghosthand";

let registration: Promise<Result<void, ComputerError>> | undefined;

/** Registers the engine once per process. Safe to call repeatedly. */
export function registerGhosthandEngine(): Promise<Result<void, ComputerError>> {
  registration ??= selectors.register(ENGINE_NAME, createGhosthandEngine, { contentScript: true }).then(
    () => ok(undefined),
    (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      if (/already been registered/.test(message)) return ok(undefined);
      registration = undefined;
      return err<ComputerError>({ kind: "driver", message: `cannot register selector engine: ${message}` });
    },
  );
  return registration;
}

export function engineSelector(command: EngineCommand): string {
  return `${ENGINE_NAME}=${Buffer.from(JSON.stringify(command), "utf8").toString("base64url")}`;
}

export type EngineError =
  | { kind: "engine_missing"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "invalid"; message: string };

/** Runs a command in `frame` and parses the JSON answer with `schema`. */
export async function runEngine<S extends z.ZodType>(
  frame: Frame,
  command: EngineCommand,
  schema: S,
  timeoutMs: number,
): Promise<Result<z.infer<S>, EngineError>> {
  let text: string | null;
  try {
    text = await frame.locator(engineSelector(command)).textContent({ timeout: timeoutMs });
  } catch (e) {
    const message = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
    if (/reading 'queryAll'|Unknown engine/.test(message))
      return err({
        kind: "engine_missing",
        message:
          "the ghosthand selector engine is not installed in this document; register it before opening pages",
      });
    return err({ kind: "unavailable", message });
  }
  if (text === null) return err({ kind: "invalid", message: "empty engine answer" });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({ kind: "invalid", message: "engine answer is not JSON" });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return err({ kind: "invalid", message: parsed.error.message.slice(0, 300) });
  return ok(parsed.data);
}
