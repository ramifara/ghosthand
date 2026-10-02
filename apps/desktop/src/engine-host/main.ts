// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Engine host entry (Electron utilityProcess). Talks to main over `process.parentPort` and to the renderer
// over the MessagePort main hands it. Playwright runs here and launches the user's browser.
import { HostPortHandoff, HostRequest } from "@ghosthand/protocol";
import { HostService, invalidRequestResponse, type PortLike } from "./host-service.ts";

interface ParentPortEvent {
  data: unknown;
  ports: PortLike[] & Array<PortLike & { start(): void }>;
}

interface ParentPort {
  on(event: "message", listener: (e: ParentPortEvent) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  process.stderr.write("engine-host must run in an Electron utilityProcess\n");
  process.exit(1);
}

const service = new HostService({
  notify: (notice) => parentPort.postMessage(notice),
  version: process.env.GHOSTHAND_APP_VERSION ?? "0.0.0",
});

parentPort.on("message", (e) => {
  if (HostPortHandoff.safeParse(e.data).success) {
    const port = e.ports[0];
    if (port) {
      port.start();
      service.setPort(port);
    }
    return;
  }
  const req = HostRequest.safeParse(e.data);
  if (!req.success) {
    const issue = req.error.issues[0];
    const res = invalidRequestResponse(
      e.data,
      issue ? `${issue.path.join(".")}: ${issue.message}` : undefined,
    );
    if (res) parentPort.postMessage(res);
    return;
  }
  void service.handle(req.data).then((res) => parentPort.postMessage(res));
});

parentPort.postMessage({ kind: "ready" });
