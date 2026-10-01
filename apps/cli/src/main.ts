#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { parseArgs } from "node:util";
import { doctorCommand } from "./commands/doctor.ts";
import { evalCommand } from "./commands/eval.ts";
import { exportCommand } from "./commands/export.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { modelsCommand } from "./commands/models.ts";
import { observeCommand } from "./commands/observe.ts";
import { browsersCommand, profileCommand } from "./commands/profile.ts";
import { replayCommand } from "./commands/replay.ts";
import { type RunFlags, runCommand } from "./commands/run.ts";
import { runsCommand } from "./commands/runs.ts";
import { tasksCommand } from "./commands/tasks.ts";
import { testCommand } from "./commands/test.ts";
import { voiceCommand } from "./commands/voice.ts";
import { fail, out } from "./io.ts";

export const HELP = `ghosthand, a Jev CUA

Usage:
  ghosthand run --url <url> (--task <id> | "<goal>") [--profile <name>] [--allow-origin <origin>]... [--headless]
                [--planner auto|codex|claude|models|none] [--writer auto|models|none] [--yes]
  ghosthand replay <runId> [--headless]
  ghosthand export <runId> [--out file.spec.ts]
  ghosthand eval [--suite l1|l1-l2|l1-l3|smoke] [--n 5] [--only id,id] [--decision jev|heuristic]
  ghosthand test <spec.md> [--runs N] [--out report.html] [--decision jev|heuristic] [--variant k=v,...]
                [--vision auto|none] [--only case-id,...] [--headless]
  ghosthand mcp [--interactive]
  ghosthand runs list [--limit N] [--task <id>]
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
    case "run":
      return runCommand(runFlags(parsed));
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
      });
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
    allowOrigins: values["allow-origin"] ?? [],
    headless: values.headless ?? false,
    yes: values.yes ?? false,
    trace: !(values["no-trace"] ?? false),
    json: values.json ?? false,
    planner: (["codex", "claude", "models", "none"].includes(values.planner ?? "")
      ? values.planner
      : "auto") as "auto" | "codex" | "claude" | "models" | "none",
    writer: (["models", "none"].includes(values.writer ?? "") ? values.writer : "auto") as
      | "auto"
      | "models"
      | "none",
  };
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
      json: { type: "boolean" },
      limit: { type: "string" },
      config: { type: "string" },
      "no-trace": { type: "boolean" },
      "no-heal": { type: "boolean" },
      suite: { type: "string" },
      planner: { type: "string" },
      provider: { type: "string" },
      role: { type: "string" },
      all: { type: "boolean" },
      writer: { type: "string" },
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
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
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
