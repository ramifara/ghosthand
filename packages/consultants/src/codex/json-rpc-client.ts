// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// JSON-RPC 2.0 over newline-delimited JSON (one message per line), as spoken by `codex app-server --listen stdio://`.
// Codex omits the `"jsonrpc": "2.0"` member on the wire (verified on codex-cli 0.159.2); we accept it when present
// and leave it out when sending, like Codex does.
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

export type JsonRpcId = number | string;

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcFailure =
  | { kind: "rpc"; method: string; code: number; message: string; data?: unknown }
  | { kind: "closed"; method: string; message: string }
  | { kind: "timeout"; method: string; message: string }
  | { kind: "cancelled"; method: string; message: string };

export type ServerRequestReply = { result: unknown } | { error: JsonRpcErrorObject };
export type ServerRequestHandler = (
  method: string,
  params: unknown,
) => ServerRequestReply | Promise<ServerRequestReply>;
export type NotificationHandler = (method: string, params: unknown) => void;
export type CloseHandler = (reason: string) => void;

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface JsonRpcClientOptions {
  /** Answers server-to-client requests. Without one, every request gets a "method not found" error. */
  onRequest?: ServerRequestHandler;
  /** Called for lines that are not valid JSON-RPC messages. They are otherwise ignored. */
  onProtocolError?: (line: string, reason: string) => void;
}

export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;

/** Splits a byte or string stream into lines; tolerates CRLF, partial chunks and split UTF-8 sequences. */
export class LineDecoder {
  #decoder = new StringDecoder("utf8");
  #buffer = "";

  push(chunk: Uint8Array | string): string[] {
    this.#buffer += typeof chunk === "string" ? chunk : this.#decoder.write(chunk);
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)).filter((l) => l.trim() !== "");
  }

  end(): string[] {
    const rest = (this.#buffer + this.#decoder.end()).trim();
    this.#buffer = "";
    return rest === "" ? [] : [rest];
  }
}

interface Pending {
  method: string;
  settle: (r: Result<unknown, JsonRpcFailure>) => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isId(v: unknown): v is JsonRpcId {
  return typeof v === "number" || typeof v === "string";
}

function parseErrorObject(v: unknown): JsonRpcErrorObject | undefined {
  if (!isRecord(v) || typeof v.code !== "number" || typeof v.message !== "string") return undefined;
  return "data" in v
    ? { code: v.code, message: v.message, data: v.data }
    : { code: v.code, message: v.message };
}

export class JsonRpcClient {
  #input: Readable;
  #output: Writable;
  #options: JsonRpcClientOptions;
  #lines = new LineDecoder();
  #nextId = 1;
  #pending = new Map<JsonRpcId, Pending>();
  #notificationHandlers = new Set<NotificationHandler>();
  #closeHandlers = new Set<CloseHandler>();
  #closedReason: string | undefined;

  constructor(streams: { input: Readable; output: Writable }, options: JsonRpcClientOptions = {}) {
    this.#input = streams.input;
    this.#output = streams.output;
    this.#options = options;
    this.#input.on("data", (chunk: Uint8Array | string) => {
      for (const line of this.#lines.push(chunk)) this.#handleLine(line);
    });
    this.#input.on("end", () => {
      for (const line of this.#lines.end()) this.#handleLine(line);
      this.close("the server closed its output");
    });
    this.#input.on("error", (e: Error) => this.close(`read error: ${e.message}`));
    this.#output.on("error", (e: Error) => this.close(`write error: ${e.message}`));
  }

  get closed(): boolean {
    return this.#closedReason !== undefined;
  }

  get closedReason(): string | undefined {
    return this.#closedReason;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  onNotification(handler: NotificationHandler): () => void {
    this.#notificationHandlers.add(handler);
    return () => this.#notificationHandlers.delete(handler);
  }

  onClose(handler: CloseHandler): () => void {
    this.#closeHandlers.add(handler);
    return () => this.#closeHandlers.delete(handler);
  }

  notify(method: string, params?: unknown): boolean {
    return this.#send(params === undefined ? { method } : { method, params });
  }

  request(
    method: string,
    params?: unknown,
    opts: RequestOptions = {},
  ): Promise<Result<unknown, JsonRpcFailure>> {
    if (this.#closedReason !== undefined) {
      return Promise.resolve(err({ kind: "closed", method, message: this.#closedReason }));
    }
    if (opts.signal?.aborted) {
      return Promise.resolve(err({ kind: "cancelled", method, message: `${method} was cancelled` }));
    }
    const id = this.#nextId++;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void =>
        settle(err({ kind: "cancelled", method, message: `${method} was cancelled` }));
      const settle = (r: Result<unknown, JsonRpcFailure>): void => {
        if (!this.#pending.delete(id)) return;
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve(r);
      };
      this.#pending.set(id, { method, settle });
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(
          () =>
            settle(
              err({ kind: "timeout", method, message: `${method} timed out after ${opts.timeoutMs} ms` }),
            ),
          opts.timeoutMs,
        );
      }
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      const message = params === undefined ? { id, method } : { id, method, params };
      if (!this.#send(message)) {
        settle(err({ kind: "closed", method, message: this.#closedReason ?? "write failed" }));
      }
    });
  }

  /** Marks the connection closed and fails every pending request. Idempotent. */
  close(reason = "closed by client"): void {
    if (this.#closedReason !== undefined) return;
    this.#closedReason = reason;
    for (const p of [...this.#pending.values()]) {
      p.settle(err({ kind: "closed", method: p.method, message: reason }));
    }
    for (const h of this.#closeHandlers) h(reason);
  }

  #send(message: Record<string, unknown>): boolean {
    if (this.#closedReason !== undefined || this.#output.destroyed || this.#output.writableEnded)
      return false;
    try {
      this.#output.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch (e) {
      this.close(`write error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  #handleLine(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.#options.onProtocolError?.(line, "invalid JSON");
      return;
    }
    if (!isRecord(raw)) {
      this.#options.onProtocolError?.(line, "not a JSON object");
      return;
    }
    const { id, method } = raw;
    if (typeof method === "string") {
      if (isId(id)) void this.#answer(id, method, raw.params);
      else this.#emitNotification(method, raw.params);
      return;
    }
    if (isId(id) && ("result" in raw || "error" in raw)) {
      const pending = this.#pending.get(id);
      if (!pending) {
        this.#options.onProtocolError?.(line, "response to an unknown request id");
        return;
      }
      if ("error" in raw) {
        const e = parseErrorObject(raw.error) ?? { code: INTERNAL_ERROR, message: "malformed error object" };
        pending.settle(err({ kind: "rpc", method: pending.method, ...e }));
      } else {
        pending.settle(ok(raw.result));
      }
      return;
    }
    this.#options.onProtocolError?.(line, "not a request, response or notification");
  }

  #emitNotification(method: string, params: unknown): void {
    for (const h of [...this.#notificationHandlers]) {
      try {
        h(method, params);
      } catch (e) {
        this.#options.onProtocolError?.(method, `notification handler threw: ${String(e)}`);
      }
    }
  }

  async #answer(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    let reply: ServerRequestReply;
    const handler = this.#options.onRequest;
    if (!handler) {
      reply = { error: { code: METHOD_NOT_FOUND, message: `client does not handle ${method}` } };
    } else {
      try {
        reply = await handler(method, params);
      } catch (e) {
        reply = { error: { code: INTERNAL_ERROR, message: e instanceof Error ? e.message : String(e) } };
      }
    }
    this.#send({ id, ...reply });
  }
}
