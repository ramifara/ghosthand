// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Routes `ghosthand:invoke` calls: sender check, zod validation, handler, Result envelope. No Electron
// import, so it is unit-tested directly. Handler exceptions never leak stack traces to the renderer.
import {
  type IpcCommandName,
  type IpcOutput,
  type IpcParsedInput,
  type IpcResponse,
  parseIpcRequest,
} from "@ghosthand/protocol";
import type { SenderInfo, SenderPolicy } from "./sender-guard.ts";
import { isTrustedSender } from "./sender-guard.ts";

export type IpcHandler<K extends IpcCommandName> = (
  input: IpcParsedInput<K>,
) => Promise<IpcResponse<IpcOutput<K>>>;

export type IpcHandlers = { [K in IpcCommandName]: IpcHandler<K> };

export interface IpcRouterOptions {
  handlers: IpcHandlers;
  policy: SenderPolicy;
  /** Called for refused or failed calls (never with payloads). */
  onProblem?: (problem: { command: string; kind: string; message: string }) => void;
}

export interface IpcRouter {
  handle(sender: SenderInfo, command: unknown, input: unknown): Promise<IpcResponse<unknown>>;
}

export function createIpcRouter(opts: IpcRouterOptions): IpcRouter {
  return {
    async handle(sender, command, input) {
      const name = typeof command === "string" ? command.slice(0, 64) : typeof command;
      if (!isTrustedSender(sender, opts.policy)) {
        opts.onProblem?.({ command: name, kind: "forbidden_sender", message: "untrusted sender frame" });
        return { ok: false, error: { kind: "forbidden_sender", message: "untrusted sender" } };
      }
      const parsed = parseIpcRequest(command, input);
      if (!parsed.ok) {
        opts.onProblem?.({ command: name, kind: parsed.error.kind, message: parsed.error.message });
        return parsed;
      }
      const handler = opts.handlers[parsed.value.command] as (
        input: unknown,
      ) => Promise<IpcResponse<unknown>>;
      try {
        return await handler(parsed.value.input);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        opts.onProblem?.({ command: name, kind: "internal", message });
        return { ok: false, error: { kind: "internal", message: `${parsed.value.command} failed` } };
      }
    },
  };
}
