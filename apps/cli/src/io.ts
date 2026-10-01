// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
export const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};
export const fail = (text: string, code = 1): number => {
  process.stderr.write(`ghosthand: ${text}\n`);
  return code;
};
