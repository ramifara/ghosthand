// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The logging surface this package needs. A pino logger satisfies it directly.

export type LogFields = Record<string, unknown>;

export interface DecisionLogger {
  debug(obj: LogFields, msg: string): void;
  info(obj: LogFields, msg: string): void;
  warn(obj: LogFields, msg: string): void;
  error(obj: LogFields, msg: string): void;
}

const drop = (): void => {};

export const silentLogger: DecisionLogger = { debug: drop, info: drop, warn: drop, error: drop };
