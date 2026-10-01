// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// pino JSON logger with a redaction hook: registered secret values and sensitive keys never reach a log.
import type { Logger, SecretsRegistry } from "@ghosthand/core";
import { type DestinationStream, destination, type Logger as PinoLogger, pino } from "pino";

export interface CreateLoggerOptions {
  level?: "debug" | "info" | "warn" | "error" | "silent";
  secrets: SecretsRegistry;
  /** Additional destinations (e.g. the per-run log file). */
  destination?: DestinationStream;
  name?: string;
}

function wrap(p: PinoLogger, secrets: SecretsRegistry): Logger {
  const clean = (fields: Record<string, unknown>) => secrets.redactValue(fields);
  const msg = (m?: string) => (m === undefined ? undefined : secrets.redact(m));
  return {
    debug: (f, m) => p.debug(clean(f), msg(m)),
    info: (f, m) => p.info(clean(f), msg(m)),
    warn: (f, m) => p.warn(clean(f), msg(m)),
    error: (f, m) => p.error(clean(f), msg(m)),
    child: (bindings) => wrap(p.child(clean(bindings)), secrets),
  };
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const level = opts.level ?? (process.env.NODE_ENV === "development" ? "debug" : "info");
  const base = pino(
    {
      name: opts.name ?? "ghosthand",
      level,
      // Belt and braces: pino's own path redaction for common header/key names.
      redact: {
        paths: ["*.password", "*.authorization", "*.cookie", "*.apiKey", "*.headers.authorization"],
        censor: "[redacted]",
      },
    },
    opts.destination ?? destination({ dest: 2, sync: true }),
  );
  return wrap(base, opts.secrets);
}

/** A logger writing JSON lines to a file (the per-run log). */
export function createFileLogger(
  path: string,
  secrets: SecretsRegistry,
  level: CreateLoggerOptions["level"] = "debug",
): {
  logger: Logger;
  flush: () => void;
} {
  const dest = destination({ dest: path, sync: true, mkdir: true });
  return { logger: createLogger({ secrets, destination: dest, level }), flush: () => dest.flushSync() };
}
