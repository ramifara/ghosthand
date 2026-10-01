// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";

export const ComputerErrorKind = z.enum([
  "launch_failed",
  "browser_not_found",
  "profile_locked",
  "navigation",
  "closed",
  "driver",
]);
export type ComputerErrorKind = z.infer<typeof ComputerErrorKind>;
export const ComputerError = z.object({ kind: ComputerErrorKind, message: z.string() });
export type ComputerError = z.infer<typeof ComputerError>;

export const ConfigErrorKind = z.enum(["missing_key", "invalid", "io"]);
export const ConfigError = z.object({
  kind: ConfigErrorKind,
  message: z.string(),
  path: z.string().optional(),
});
export type ConfigError = z.infer<typeof ConfigError>;

export const RecorderErrorKind = z.enum(["io", "not_found", "corrupt"]);
export const RecorderError = z.object({ kind: RecorderErrorKind, message: z.string() });
export type RecorderError = z.infer<typeof RecorderError>;
