// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One-shot OAuth callback server on 127.0.0.1 (SIWC forbids `localhost`). Tries the preferred port and
// falls back to an ephemeral one; the path must match exactly. It resolves with the first request to the
// callback path and is closed (including idle keep-alive sockets) right after.
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface LoopbackServer {
  readonly port: number;
  readonly redirectUri: string;
  /** Resolves with the full callback URL. */
  readonly callback: Promise<string>;
  close(): void;
}

const page = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><body style="font:15px system-ui;margin:3rem;max-width:32rem"><h1 style="font-size:1.2rem">${title}</h1><p>${body}</p></body>`;

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => {
      server.off("listening", onListening);
      reject(e);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startLoopbackServer(opts: {
  preferredPort: number;
  path: string;
  timeoutMs?: number;
}): Promise<LoopbackServer> {
  let resolveCallback!: (url: string) => void;
  let rejectCallback!: (e: Error) => void;
  const callback = new Promise<string>((res, rej) => {
    resolveCallback = res;
    rejectCallback = rej;
  });
  // Callers may never await it (cancel); avoid an unhandled rejection.
  callback.catch(() => {});
  let port = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method !== "GET" || url.pathname !== opts.path) {
      send(res, 404, page("Not found", "This address only accepts the GhostHand sign-in callback."));
      return;
    }
    const failed = url.searchParams.has("error");
    send(
      res,
      failed ? 400 : 200,
      failed
        ? page("ChatGPT was not connected", "You can close this tab and try again in GhostHand.")
        : page("Signed in", "You can close this tab and return to GhostHand."),
    );
    resolveCallback(url.toString());
  });
  try {
    port = await listen(server, opts.preferredPort);
  } catch {
    port = await listen(server, 0);
  }
  const timer = setTimeout(
    () => rejectCallback(new Error("sign-in timed out")),
    opts.timeoutMs ?? 5 * 60 * 1000,
  );
  return {
    port,
    redirectUri: `http://127.0.0.1:${port}${opts.path}`,
    callback,
    close() {
      clearTimeout(timer);
      rejectCallback(new Error("sign-in closed"));
      server.close();
      server.closeAllConnections();
    },
  };
}
