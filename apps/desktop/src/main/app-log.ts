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

export class AppLog {
  readonly dir: string;
  readonly file: string;
  readonly #stream: WriteStream | undefined;
  readonly #echo: boolean;

  constructor(dir: string, opts: { echo?: boolean } = {}) {
    this.dir = dir;
    this.file = join(dir, LOG_FILE);
    this.#echo = opts.echo ?? false;
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
    this.#stream?.write(chunk);
    if (this.#echo) process.stderr.write(chunk);
  }

  /** A timestamped line from main. */
  line(text: string): void {
    this.write(`${new Date().toISOString()} main: ${text}\n`);
  }

  close(): void {
    this.#stream?.end();
  }
}
