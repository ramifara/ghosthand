// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The renderer's only door to the app: `window.ghosthand` from the preload. `call` unwraps the Result
// envelope and validates the output, throwing `IpcCallError` so TanStack Query sees failures.
import {
  type GhostHandBridge,
  type IpcCommandName,
  IpcCommands,
  type IpcError,
  type IpcInput,
  type IpcOutput,
} from "@ghosthand/protocol";

declare global {
  interface Window {
    ghosthand?: GhostHandBridge;
  }
}

export class IpcCallError extends Error {
  readonly kind: IpcError["kind"];
  constructor(error: IpcError) {
    super(error.message);
    this.kind = error.kind;
  }
}

export function bridge(): GhostHandBridge {
  const b = window.ghosthand;
  if (!b) throw new Error("window.ghosthand is missing (the preload did not run)");
  return b;
}

export async function call<K extends IpcCommandName>(command: K, input?: IpcInput<K>): Promise<IpcOutput<K>> {
  const r = await bridge().invoke(command, input);
  if (!r.ok) throw new IpcCallError(r.error);
  const parsed = IpcCommands[command].output.safeParse(r.value);
  if (!parsed.success)
    throw new IpcCallError({ kind: "internal", message: `${command}: unexpected response` });
  return parsed.data as IpcOutput<K>;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
