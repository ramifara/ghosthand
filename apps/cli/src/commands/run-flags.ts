// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { DesktopLaunchOptions, PlannerChoice, WriterChoice } from "@ghosthand/engine";
import type { ExtrasFlags } from "../run-extras.ts";

export interface RunFlags {
  url?: string;
  task?: string;
  goal?: string;
  profile?: string;
  allowOrigins: string[];
  headless: boolean;
  yes: boolean;
  trace: boolean;
  json: boolean;
  config?: string;
  planner: PlannerChoice;
  writer: WriterChoice;
  /** "web" (default) or a desktop surface. */
  surface?: "web" | DesktopLaunchOptions["surface"];
  /** Desktop app command line. */
  app?: string;
  /** X11 sandbox runtime. */
  runtime?: "auto" | "docker" | "podman" | "host";
  /** noVNC live view port on 127.0.0.1 (X11 container). */
  vncPort?: number;
  /** Give the X11 container network access. */
  network?: boolean;
  /** Windows/macOS: drive the real desktop. */
  allowHostDesktop?: boolean;
  /** Phase 3: recipes, learning, source-aware mode and vision (web runs). */
  extras: ExtrasFlags;
}
