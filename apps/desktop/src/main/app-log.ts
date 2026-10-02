// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The app's log file: the engine host's stdout/stderr and main's own notes go to <userData>/logs/
// engine-host.log. A packaged app has no console, so this is the only place a failed run start can be
// read back from. The previous file is kept as engine-host.prev.log; nothing in it is a secret (pino's
// redaction runs in the host, main never logs values).
import { createWriteStream, existsSync, mkdirSync, renameSync, type WriteStream } from "node:fs";
import { join } from "node:path";

export const LOG_FILE = "engine-host.log";
export const PREVIOUS_LOG_FILE = "engine-host.prev.log";
/** Headed Chromium chatters on stderr all day; past this the file stops growing (the console echo continues). */
export const MAX_LOG_BYTES = 32 * 1024 * 1024;

export class AppLog {
  readonly dir: string;
  readonly file: string;
  readonly #stream: WriteStream | undefined;
  readonly #echo: boolean;
  readonly #maxBytes: number;
  #bytes = 0;

  constructor(dir: string, opts: { echo?: boolean; maxBytes?: number } = {}) {
    this.dir = dir;
    this.file = join(dir, LOG_FILE);
    this.#echo = opts.echo ?? false;
    this.#maxBytes = opts.maxBytes ?? MAX_LOG_BYTES;
    let stream: WriteStream | undefined;
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(this.file)) renameSync(this.file, join(dir, PREVIOUS_LOG_FILE));
      stream = createWriteStream(this.file, { flags: "a", mode: 0o600 });
      stream.on("error", () => {
        // A full or read-only disk must not take the app down; the echo still reaches a console.
      });
    } catch {
      stream = undefined;
    }
    this.#stream = stream;
  }

  /** Raw chunk from the host's stdout/stderr. */
  write(chunk: string | Uint8Array): void {
    if (this.#echo) process.stderr.write(chunk);
    if (!this.#stream || this.#bytes > this.#maxBytes) return;
    this.#bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
    this.#stream.write(chunk);
    if (this.#bytes > this.#maxBytes) this.#stream.write("\n[log full: later output is not kept]\n");
  }

  /** A timestamped line from main. */
  line(text: string): void {
    this.write(`${new Date().toISOString()} main: ${text}\n`);
  }

  close(): void {
    this.#stream?.end();
  }
}
