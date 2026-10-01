// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Test helpers: the recorded GTK testbed snapshot and a scripted RPC transport (no processes).
import { readFileSync } from "node:fs";
import type {
  DesktopRpcMethod,
  DesktopRpcParams,
  DesktopRpcResult,
  HelloResult,
  Result,
  RpcSnapshot,
} from "@ghosthand/protocol";
import { err, ok, RpcSnapshot as RpcSnapshotSchema } from "@ghosthand/protocol";
import type { RpcCallError, RpcTransport } from "./rpc/rpc-client.ts";

export function gtkTestbedSnapshot(): RpcSnapshot {
  const raw: unknown = JSON.parse(
    readFileSync(new URL("./__fixtures__/gtk-testbed-snapshot.json", import.meta.url), "utf8"),
  );
  return RpcSnapshotSchema.parse(raw);
}

export const X11_HELLO: HelloResult = {
  protocolVersion: 1,
  host: { name: "fake-host", version: "0" },
  platform: "linux-x11",
  capabilities: {
    semanticActions: true,
    pointer: true,
    screenshots: true,
    recording: false,
    boundsTrust: "exact",
  },
  screen: { width: 1280, height: 800, scale: 1 },
};

type Handler = (params: unknown) => unknown;

/** A transport that answers from handlers (or scripted errors) and records every call. */
export class ScriptedTransport implements RpcTransport {
  readonly calls: Array<{ method: DesktopRpcMethod; params: unknown }> = [];
  readonly #handlers = new Map<DesktopRpcMethod, Handler>();
  readonly #errors = new Map<DesktopRpcMethod, RpcCallError>();
  closed = false;

  on<M extends DesktopRpcMethod>(method: M, fn: (params: DesktopRpcParams<M>) => DesktopRpcResult<M>): this {
    this.#handlers.set(method, (p) => fn(p as DesktopRpcParams<M>));
    return this;
  }

  /** The next call of `method` fails with `error`. */
  failNext(method: DesktopRpcMethod, error: RpcCallError): this {
    this.#errors.set(method, error);
    return this;
  }

  call<M extends DesktopRpcMethod>(
    method: M,
    params: DesktopRpcParams<M>,
  ): Promise<Result<DesktopRpcResult<M>, RpcCallError>> {
    this.calls.push({ method, params });
    const e = this.#errors.get(method);
    if (e) {
      this.#errors.delete(method);
      return Promise.resolve(err(e));
    }
    const h = this.#handlers.get(method);
    if (!h) return Promise.resolve(err({ kind: "unsupported", message: `no handler for ${method}` }));
    return Promise.resolve(ok(h(params) as DesktopRpcResult<M>));
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
