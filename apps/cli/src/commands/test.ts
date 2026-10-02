// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand test <spec.md>`: QA mode. Runs a Markdown spec, writes a scored HTML report and its JSON.
import { openRuntime, parseVariantFlag, runQaSpecFile } from "@ghosthand/engine";
import type { BrowserBehaviorInput } from "@ghosthand/protocol";
import { fail, out } from "../io.ts";

export interface TestFlags {
  spec: string | undefined;
  runs?: number;
  out?: string;
  decision: "jev" | "heuristic";
  vision: "auto" | "none";
  variant?: string;
  headless: boolean;
  profile?: string;
  only?: string[];
  config?: string;
  browserBehavior?: BrowserBehaviorInput;
  json: boolean;
}

export async function testCommand(flags: TestFlags): Promise<number> {
  if (!flags.spec) return fail("give a spec file: ghosthand test <spec.md>", 2);
  if (flags.runs !== undefined && (!Number.isInteger(flags.runs) || flags.runs < 1 || flags.runs > 20))
    return fail("--runs must be an integer from 1 to 20", 2);
  const opened = await openRuntime({
    ...(flags.config ? { configPath: flags.config } : {}),
    logLevel: "warn",
    ...(flags.browserBehavior ? { overrides: { browser: { behavior: flags.browserBehavior } } } : {}),
  });
  if (!opened.ok) return fail(opened.error.message);
  const rt = opened.value;
  for (const w of rt.warnings) process.stderr.write(`warn: ${w}\n`);
  const variant = parseVariantFlag(flags.variant);
  const r = await runQaSpecFile(rt, {
    specPath: flags.spec,
    decision: flags.decision,
    vision: flags.vision,
    headless: flags.headless,
    ...(flags.runs ? { runs: flags.runs } : {}),
    ...(flags.out ? { out: flags.out } : {}),
    ...(Object.keys(variant).length > 0 ? { variant } : {}),
    ...(flags.profile ? { profile: flags.profile } : {}),
    ...(flags.only ? { only: flags.only } : {}),
    onProgress: (line) => process.stderr.write(`${line}\n`),
  });
  if (!r.ok) return fail(r.error.message, r.error.kind === "invalid_spec" ? 2 : 1);
  const { report, htmlPath, jsonPath } = r.value;
  if (flags.json)
    out(
      JSON.stringify(
        { verdict: report.verdict, score: report.score, htmlPath, jsonPath, summary: report.summaryLine },
        null,
        2,
      ),
    );
  else {
    out(report.summaryLine);
    for (const b of report.plantedBugs)
      out(
        `planted bug ${b.flag}: ${b.active ? (b.caught ? "caught" : "MISSED") : "inactive"} (${b.caughtRuns}/${b.runs} runs of "${b.expectedCase}" failed)`,
      );
    out(`report ${htmlPath}`);
    out(`json   ${jsonPath}`);
  }
  return report.verdict === "PASS" ? 0 : 1;
}
