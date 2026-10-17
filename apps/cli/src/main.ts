#!/usr/bin/env node
import { parseArgs } from "node:util";
import type { PlannerChoice, WriterChoice } from "@ghosthand/engine";
import type { BrowserBehaviorInput } from "@ghosthand/protocol";
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { DecisionImages, Guidance } from "@ghosthand/protocol";
import { doctorCommand } from "./commands/doctor.ts";
import { evalCommand } from "./commands/eval.ts";
import { exportCommand } from "./commands/export.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { modelsCommand } from "./commands/models.ts";
import { observeCommand } from "./commands/observe.ts";
import { browsersCommand, profileCommand } from "./commands/profile.ts";
import { mapCommand, recipesCommand } from "./commands/recipes.ts";
import { replayCommand } from "./commands/replay.ts";
import { runCommand } from "./commands/run.ts";
import type { RunFlags } from "./commands/run-flags.ts";
import { runsCommand } from "./commands/runs.ts";
import { sourcemapCommand } from "./commands/sourcemap.ts";
import { tasksCommand } from "./commands/tasks.ts";
import { testCommand } from "./commands/test.ts";
import { voiceCommand } from "./commands/voice.ts";
import { fail, out } from "./io.ts";

/** `--jev-images off|grounding|always` and `--jev-vision-model <id>` (ADR 0020) as decision config overrides. */
export function jevFlags(values: ReturnType<typeof parse>["values"]): {
  images?: DecisionImages;
  visionModel?: string;
} {
  const images = DecisionImages.safeParse(values["jev-images"]);
  return {
    ...(images.success ? { images: images.data } : {}),
    ...(values["jev-vision-model"] ? { visionModel: values["jev-vision-model"] } : {}),
  };
}

/** `--guidance off|stuck|unsure|every` (ADR 0017) as a spreadable option; anything else leaves the default. */
function guidanceSpread(value: string | undefined): { guidance: Guidance } | Record<string, never> {
  const parsed = Guidance.safeParse(value);
  return parsed.success ? { guidance: parsed.data } : {};
}

export const HELP = `ghosthand, a Jev CUA

Usage:
  ghosthand run --url <url> (--task <id> | "<goal>") [--profile <name>] [--allow-origin <origin>]... [--headless]
                [--unattended] [--creds <KEY=value file>]
                [--planner auto|codex|claude|models|none] [--writer auto|models|none] [--yes]
                [--guidance off|stuck|unsure|every] [--learn] [--recipes auto|off] [--source <app src dir>] [--vision auto|off]
                [--jev-images off|grounding|always] [--jev-vision-model <id>]
  ghosthand run --surface x11|wayland|windows|macos (--task desktop-<id> | --app "<command>" "<goal>")
                [--runtime auto|docker|podman|host] [--vnc-port <port>] [--network] [--allow-host-desktop] [--yes]
  ghosthand replay <runId> [--headless]
  ghosthand export <runId> [--out file.spec.ts]
  ghosthand eval [--suite l1|l1-l2|l1-l3|l4|l5|l6|l4-l6|smoke] [--n 5] [--only id,id] [--decision jev|heuristic]
                [--learn] [--recipes auto|off] [--source <app src dir>] [--vision auto|off] [--start-path /] [--profile <name>]
  ghosthand test <spec.md> [--runs N] [--out report.html] [--decision jev|heuristic] [--variant k=v,...]
                [--vision auto|none] [--only case-id,...] [--headless]
  ghosthand mcp [--interactive]
  ghosthand runs list [--limit N] [--task <id>]
  ghosthand recipes list | show <id> | export <id> [--out file.spec.ts] | remove <id>
  ghosthand map [--origin <origin>]
  ghosthand sourcemap <dir> [--diff <base>]
  ghosthand doctor
  ghosthand models list [--provider <id>] [--role planner|writer|vision_reviewer|vision_grounder|judge] [--all]
  ghosthand profile create <name> | list | import <chrome-profile-dir> <name> | remove <name>
  ghosthand browsers
  ghosthand tasks
  ghosthand observe --url <url> [--headless]
  ghosthand voice transcribe <file.wav> [--backend auto|moonshine|whisper|openai|deepgram] [--model <id>]
  ghosthand voice models list | download <id> | verify <id> | remove <id>
  ghosthand voice parse "<utterance>"

Options:
  --json        machine-readable output
  --config      path to ghosthand.config.ts
  --reduce-automation-markers  reduce Chromium automation signals (run/test, best effort)
  --human-input  vary mouse, typing and scroll timing (run/test)
  --native-window  use the real browser window size (run/test)
  --locale <en-US>  browser language (run/test)
  --timezone <Europe/Berlin>  browser timezone (run/test)
  -h, --help    show this help
`;

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 2);
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    out(HELP);
    return command ? 0 : values.help ? 0 : 2;
  }
  const json = values.json ?? false;
  switch (command) {
    case "runs":
      return runsCommand(rest, {
        json,
        ...(values.limit ? { limit: values.limit } : {}),
        ...(values.task ? { task: values.task } : {}),
      });
    case "profile":
      return profileCommand(rest, json);
    case "browsers":
      return browsersCommand(json);
    case "doctor":
      return doctorCommand(json);
    case "models":
      return modelsCommand(rest, {
        json,
        ...(values.provider ? { provider: values.provider } : {}),
        ...(values.role ? { role: values.role } : {}),
        ...(values.all ? { all: true } : {}),
        ...(values.config ? { config: values.config } : {}),
      });
    case "run": {
      let flags: RunFlags;
      try {
        flags = runFlags(parsed);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e), 2);
      }
      return runCommand(flags);
    }
    case "replay":
      return replayCommand(rest[0], {
        headless: values.headless ?? false,
        json,
        heal: !(values["no-heal"] ?? false),
        ...(values.profile ? { profile: values.profile } : {}),
      });
    case "export":
      return exportCommand(rest[0], { ...(values.out ? { out: values.out } : {}) });
    case "eval":
      return evalCommand({
        suite: values.suite ?? "l1",
        n: Number(values.n ?? "5"),
        ...(values.only ? { only: values.only.split(",") } : {}),
        headless: values.headless ?? false,
        decision: values.decision === "heuristic" ? "heuristic" : "jev",
        ...(values.out ? { out: values.out } : {}),
        json,
        planner: (["codex", "claude", "models", "none"].includes(values.planner ?? "")
          ? values.planner
          : "auto") as PlannerChoice,
        writer: (["models", "codex", "none"].includes(values.writer ?? "")
          ? values.writer
          : "auto") as WriterChoice,
        ...guidanceSpread(values.guidance),
        jev: jevFlags(values),
        // Evals keep runs independent: recipes and learning only when asked (ADR 0011).
        extras: extrasFlags(values, "off"),
        ...(values["start-path"] ? { startPath: values["start-path"] } : {}),
        ...(values.profile ? { profile: values.profile } : {}),
      });
    case "recipes":
      return recipesCommand(rest, {
        json,
        ...(values.out ? { out: values.out } : {}),
        ...(values.origin ? { app: values.origin } : {}),
      });
    case "map":
      return mapCommand({ json, ...(values.origin ? { app: values.origin } : {}) });
    case "sourcemap":
      return sourcemapCommand(rest[0], { json, ...(values.diff ? { diff: values.diff } : {}) });
    case "tasks":
      return tasksCommand(json);
    case "test":
      return testCommand({
        spec: rest[0],
        ...(values.runs ? { runs: Number(values.runs) } : {}),
        ...(values.out ? { out: values.out } : {}),
        decision: values.decision === "heuristic" ? "heuristic" : "jev",
        vision: values.vision === "none" ? "none" : "auto",
        ...(values.variant ? { variant: values.variant } : {}),
        headless: values.headless ?? false,
        ...(values.profile ? { profile: values.profile } : {}),
        ...(values.only ? { only: values.only.split(",") } : {}),
        ...(values.config ? { config: values.config } : {}),
        json,
        browserBehavior: browserFlags(values),
      });
    case "mcp":
      return mcpCommand({
        interactive: values.interactive ?? false,
        ...(values.config ? { config: values.config } : {}),
      });
    case "observe":
      return observeCommand(values.url, {
        headless: values.headless ?? false,
        json,
        ...(values.profile ? { profile: values.profile } : {}),
      });
    case "voice":
      return voiceCommand(rest, {
        json,
        ...(values.backend ? { backend: values.backend } : {}),
        ...(values.model ? { model: values.model } : {}),
        ...(values.language ? { language: values.language } : {}),
        ...(values["models-dir"] ? { modelsDir: values["models-dir"] } : {}),
      });
    default:
      return fail(`unknown command "${command}"\n\n${HELP}`, 2);
  }
}

/** `ghosthand run` flags from parsed arguments (every `--allow-origin` is kept, in order). */
export function runFlags({ values, positionals }: ReturnType<typeof parse>): RunFlags {
  const rest = positionals.slice(1);
  return {
    ...(values.url ? { url: values.url } : {}),
    ...(values.task ? { task: values.task } : {}),
    ...(rest.length > 0 ? { goal: rest.join(" ") } : {}),
    ...(values.profile ? { profile: values.profile } : {}),
    ...(values.config ? { config: values.config } : {}),
    browserBehavior: browserFlags(values),
    allowOrigins: values["allow-origin"] ?? [],
    headless: values.headless ?? false,
    yes: values.yes ?? false,
    unattended: values.unattended ?? false,
    ...(values.creds ? { creds: values.creds } : {}),
    trace: !(values["no-trace"] ?? false),
    json: values.json ?? false,
    planner: (["codex", "claude", "models", "none"].includes(values.planner ?? "")
      ? values.planner
      : "auto") as "auto" | "codex" | "claude" | "models" | "none",
    writer: (["models", "codex", "none"].includes(values.writer ?? "")
      ? values.writer
      : "auto") as WriterChoice,
    ...guidanceSpread(values.guidance),
    jev: jevFlags(values),
    ...(values.surface ? { surface: surfaceFlag(values.surface) } : {}),
    ...(values.app ? { app: values.app } : {}),
    ...(values.runtime ? { runtime: runtimeFlag(values.runtime) } : {}),
    ...(values["vnc-port"] ? { vncPort: Number(values["vnc-port"]) } : {}),
    ...(values.network ? { network: true } : {}),
    ...(values["allow-host-desktop"] ? { allowHostDesktop: true } : {}),
    extras: extrasFlags(values, "auto"),
  };
}

/** Phase 3 flags shared by `run` and `eval`; `recipesDefault` differs (ADR 0011). */
export function extrasFlags(
  values: ReturnType<typeof parse>["values"],
  recipesDefault: "auto" | "off",
): RunFlags["extras"] {
  return {
    learn: values.learn ?? false,
    recipes: values.recipes === "auto" || values.recipes === "off" ? values.recipes : recipesDefault,
    ...(values.source ? { source: values.source } : {}),
    vision: values.vision === "off" ? "off" : "auto",
  };
}

const SURFACES = ["web", "x11", "wayland", "windows", "macos"] as const;
const RUNTIMES = ["auto", "docker", "podman", "host"] as const;

/** Throws on an unknown value (reported as a usage error by `main`). */
export function surfaceFlag(v: string): (typeof SURFACES)[number] {
  const hit = SURFACES.find((s) => s === v);
  if (!hit) throw new Error(`--surface must be one of ${SURFACES.join(", ")}`);
  return hit;
}

export function runtimeFlag(v: string): (typeof RUNTIMES)[number] {
  const hit = RUNTIMES.find((s) => s === v);
  if (!hit) throw new Error(`--runtime must be one of ${RUNTIMES.join(", ")}`);
  return hit;
}

export function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      task: { type: "string" },
      profile: { type: "string" },
      "allow-origin": { type: "string", multiple: true },
      headless: { type: "boolean" },
      "reduce-automation-markers": { type: "boolean" },
      "human-input": { type: "boolean" },
      "native-window": { type: "boolean" },
      locale: { type: "string" },
      timezone: { type: "string" },
      json: { type: "boolean" },
      limit: { type: "string" },
      config: { type: "string" },
      "no-trace": { type: "boolean" },
      "no-heal": { type: "boolean" },
      unattended: { type: "boolean" },
      creds: { type: "string" },
      suite: { type: "string" },
      planner: { type: "string" },
      provider: { type: "string" },
      role: { type: "string" },
      all: { type: "boolean" },
      writer: { type: "string" },
      guidance: { type: "string" },
      "jev-images": { type: "string" },
      "jev-vision-model": { type: "string" },
      n: { type: "string" },
      only: { type: "string" },
      decision: { type: "string" },
      out: { type: "string" },
      runs: { type: "string" },
      variant: { type: "string" },
      vision: { type: "string" },
      interactive: { type: "boolean" },
      backend: { type: "string" },
      model: { type: "string" },
      language: { type: "string" },
      "models-dir": { type: "string" },
      surface: { type: "string" },
      app: { type: "string" },
      runtime: { type: "string" },
      "vnc-port": { type: "string" },
      network: { type: "boolean" },
      "allow-host-desktop": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      learn: { type: "boolean" },
      recipes: { type: "string" },
      source: { type: "string" },
      "start-path": { type: "string" },
      origin: { type: "string" },
      diff: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

/** Only explicit flags override the file's browser behavior. */
export function browserFlags(values: ReturnType<typeof parse>["values"]): BrowserBehaviorInput {
  return {
    ...(values["reduce-automation-markers"] ? { reduceAutomationMarkers: true } : {}),
    ...(values["human-input"] ? { inputPacing: "human" as const } : {}),
    ...(values["native-window"] ? { nativeWindow: true } : {}),
    ...(values.locale !== undefined ? { locale: values.locale } : {}),
    ...(values.timezone !== undefined ? { timezoneId: values.timezone } : {}),
  };
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.exitCode = fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
    },
  );
}
