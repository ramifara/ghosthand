// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Launches a desktop Computer for a run (X11 sandbox, GNOME Wayland sandbox, Windows UIA, macOS AX) and
// prepares desktop testbed tasks with their state-file oracles.
import {
  type DesktopApp,
  type DesktopSurface,
  type DesktopTask,
  desktopTaskIds,
  desktopTaskSpec,
  getDesktopTask,
  gradeDesktopTask,
  launchDesktop,
  type SandboxRuntime,
  splitCommand,
  testbedApp,
} from "@ghosthand/driver-desktop";
import type { TaskSpec } from "@ghosthand/protocol";
import type { ComputerLauncher } from "./run-agent.ts";
import type { EngineRuntime } from "./runtime.ts";

export interface DesktopLaunchOptions {
  surface: DesktopSurface;
  /** Command line of the app to launch (e.g. "gnome-calculator" or "python3 app.py"). */
  app?: string;
  /** Launch the desktop testbed app with this seed instead of `app`. */
  testbedSeed?: string;
  runtime?: "auto" | SandboxRuntime;
  /** noVNC live view on 127.0.0.1:<port> (X11 container). */
  vncPort?: number;
  network?: boolean;
  /** Windows/macOS act on the real desktop: explicit opt-in. */
  allowHostDesktop?: boolean;
  hostBinary?: string;
  /** Receives the sandbox's shared folder once it exists (task oracles read the state file there). */
  onWorkDir?: (dir: string) => void;
}

function appOf(opts: DesktopLaunchOptions): {
  app?: DesktopApp;
  appFor?: (ctx: { runtime: SandboxRuntime | "native"; sandboxWorkDir: string }) => DesktopApp;
} {
  if (opts.testbedSeed !== undefined) {
    const seed = opts.testbedSeed;
    return { appFor: (ctx) => testbedApp(ctx.runtime, ctx.sandboxWorkDir, seed) };
  }
  if (opts.app !== undefined) {
    const argv = splitCommand(opts.app);
    if (argv.length > 0) return { app: { argv } };
  }
  return {};
}

/** A ComputerLauncher for `runAgent` on a desktop surface. */
export function desktopLauncher(rt: EngineRuntime, opts: DesktopLaunchOptions): ComputerLauncher {
  return async () => {
    const launched = await launchDesktop({
      surface: opts.surface,
      ...appOf(opts),
      ...(opts.runtime ? { runtime: opts.runtime } : {}),
      ...(opts.vncPort !== undefined ? { vncPort: opts.vncPort } : {}),
      ...(opts.network !== undefined ? { network: opts.network } : {}),
      ...(opts.allowHostDesktop ? { allowHostDesktop: true } : {}),
      ...(opts.hostBinary ? { hostBinary: opts.hostBinary } : {}),
      secrets: rt.secrets,
      logger: rt.logger.child({ pkg: "driver-desktop" }),
    });
    if (!launched.ok)
      return { ok: false, error: { message: `${launched.error.kind}: ${launched.error.message}` } };
    const { computer, workDir, describe } = launched.value;
    if (workDir !== undefined) opts.onWorkDir?.(workDir);
    return { ok: true, value: { computer, surface: describe, close: () => computer.close() } };
  };
}

export interface PreparedDesktopRun {
  task: DesktopTask;
  spec: TaskSpec;
  /** Launch options for this task's testbed app; pass to `desktopLauncher` together with the surface. */
  launch: Pick<DesktopLaunchOptions, "testbedSeed" | "onWorkDir">;
  /** Grades the run from the testbed's state file. */
  oracle: (taskId: string) => Promise<boolean | undefined>;
  /** Detail of the last grading (for reports). */
  lastVerdict: () => string | undefined;
}

export const isDesktopTask = (id: string): boolean => getDesktopTask(id) !== undefined;
export { desktopTaskIds };

export function prepareDesktopRun(
  taskId: string,
): { ok: true; value: PreparedDesktopRun } | { ok: false; error: { message: string } } {
  const task = getDesktopTask(taskId);
  if (!task)
    return {
      ok: false,
      error: { message: `unknown desktop task "${taskId}" (known: ${desktopTaskIds().join(", ")})` },
    };
  let workDir: string | undefined;
  let verdict: string | undefined;
  return {
    ok: true,
    value: {
      task,
      spec: desktopTaskSpec(task),
      launch: {
        testbedSeed: task.seed,
        onWorkDir: (dir) => {
          workDir = dir;
        },
      },
      oracle: async () => {
        if (workDir === undefined) return undefined;
        const v = gradeDesktopTask(task, workDir);
        verdict = v.detail;
        return v.pass;
      },
      lastVerdict: () => verdict,
    },
  };
}
