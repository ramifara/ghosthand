// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Minimal logger contract (a subset of pino). The engine injects a pino child logger with redaction.

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(fields: LogFields, msg?: string): void;
  info(fields: LogFields, msg?: string): void;
  warn(fields: LogFields, msg?: string): void;
  error(fields: LogFields, msg?: string): void;
  child(bindings: LogFields): Logger;
}

const noop = () => {};

export const noopLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => noopLogger,
};

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
