// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Spawns a native host, checks the protocol version and wraps it in a DesktopComputer.
import type { Logger, SecretsRegistry } from "@ghosthand/core";
import type { ComputerError, HelloResult, Result, SurfaceKind } from "@ghosthand/protocol";
import { DESKTOP_RPC_VERSION, err, ok } from "@ghosthand/protocol";
import type { DesktopApp, SharedDir } from "../desktop-computer.ts";
import { DesktopComputer } from "../desktop-computer.ts";
import type { SpawnHostOptions } from "../rpc/rpc-client.ts";
import { spawnRpcHost } from "../rpc/rpc-client.ts";

export interface ConnectHostOptions {
  spawn: SpawnHostOptions;
  surface: Exclude<SurfaceKind, "web">;
  app?: DesktopApp;
  secrets?: SecretsRegistry;
  shared?: SharedDir;
  maxElements?: number;
  logger?: Logger;
  onClose?: () => Promise<void>;
}

export interface ConnectedHost {
  computer: DesktopComputer;
  hello: HelloResult;
}

export async function connectHost(opts: ConnectHostOptions): Promise<Result<ConnectedHost, ComputerError>> {
  const spawned = await spawnRpcHost({ ...opts.spawn, ...(opts.logger ? { logger: opts.logger } : {}) });
  if (!spawned.ok) {
    await opts.onClose?.();
    return spawned;
  }
  const client = spawned.value;
  const hello = await client.call("hello", { client: "ghosthand", protocolVersion: DESKTOP_RPC_VERSION });
  if (!hello.ok || hello.value.protocolVersion !== DESKTOP_RPC_VERSION) {
    await client.close();
    await opts.onClose?.();
    return err({
      kind: "launch_failed",
      message: hello.ok
        ? `host speaks protocol ${hello.value.protocolVersion}; this client needs ${DESKTOP_RPC_VERSION}`
        : `hello failed: ${hello.error.message}`,
    });
  }
  const computer = new DesktopComputer({
    transport: client,
    hello: hello.value,
    surface: opts.surface,
    ...(opts.app ? { app: opts.app } : {}),
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
    ...(opts.shared ? { shared: opts.shared } : {}),
    ...(opts.maxElements ? { maxElements: opts.maxElements } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.onClose ? { onClose: opts.onClose } : {}),
  });
  return ok({ computer, hello: hello.value });
}
