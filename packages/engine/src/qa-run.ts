// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand test` and MCP `run_spec`: read a spec file, run it on the web, write the HTML and JSON report.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { HeuristicDecisionProvider } from "@ghosthand/core";
import type { DecisionProvider } from "@ghosthand/protocol";
import {
  parseSpec,
  type QaReport,
  QaReport as QaReportSchema,
  renderHtmlReport,
  runSpec,
  type SpecError,
  type VisionJudge,
} from "@ghosthand/qa";
import { createModelsClient } from "./assistants.ts";
import { createWebCaseExecutor, effectiveVariant, type VariantValue } from "./qa-executor.ts";
import { createModelVisionJudge } from "./qa-vision.ts";
import { createDecisionProvider, type EngineRuntime } from "./runtime.ts";

export interface QaRunOptions {
  specPath: string;
  runs?: number;
  /** HTML report path; the JSON goes next to it. Default `<runsDir>/../qa/<stamp>-<spec>/report.html`. */
  out?: string;
  decision?: "jev" | "heuristic";
  /** `auto` uses the models layer when an OpenAI key is configured. */
  vision?: "auto" | "none";
  variant?: Record<string, VariantValue>;
  headless?: boolean;
  profile?: string;
  a11y?: boolean;
  only?: string[];
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export interface QaRunResult {
  report: QaReport;
  htmlPath: string;
  jsonPath: string;
}

export type QaRunError = SpecError | { kind: "io" | "config"; message: string };

/** Parses `k=v,k2=v2` (CLI `--variant`). */
export function parseVariantFlag(raw: string | undefined): Record<string, VariantValue> {
  const out: Record<string, VariantValue> = {};
  for (const part of (raw ?? "").split(",")) {
    const [k, v] = part.split("=");
    if (k?.trim() && v !== undefined) out[k.trim()] = v.trim();
  }
  return out;
}

export function defaultReportPath(rt: EngineRuntime, specPath: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const name = basename(specPath).replace(/\.md$/i, "");
  return join(rt.runsDir, "..", "qa", `${stamp}-${name}`, "report.html");
}

export async function runQaSpecFile(
  rt: EngineRuntime,
  opts: QaRunOptions,
): Promise<{ ok: true; value: QaRunResult } | { ok: false; error: QaRunError }> {
  let markdown: string;
  const specPath = resolve(opts.specPath);
  try {
    markdown = readFileSync(specPath, "utf8");
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "io",
        message: `cannot read ${specPath}: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  const parsed = parseSpec(markdown, opts.specPath);
  if (!parsed.ok) return parsed;
  const spec = parsed.value;

  let decision: () => DecisionProvider;
  if (opts.decision === "heuristic") decision = () => new HeuristicDecisionProvider();
  else {
    const probe = createDecisionProvider(rt, spec.frontMatter.budget.usd);
    if (!probe.ok) return { ok: false, error: { kind: "config", message: probe.error.message } };
    decision = () => {
      const d = createDecisionProvider(rt, spec.frontMatter.budget.usd);
      if (!d.ok) throw new Error(d.error.message);
      return d.value;
    };
  }
  let vision: VisionJudge | undefined;
  if (opts.vision !== "none") {
    const client = createModelsClient(rt);
    if (client) vision = createModelVisionJudge(client);
  }
  const executor = createWebCaseExecutor(rt, {
    spec,
    ...(opts.headless !== undefined ? { headless: opts.headless } : {}),
    // A profile of its own, so QA runs never collide with an interactive browser on "default".
    profile: opts.profile ?? "qa",
    ...(opts.variant ? { variant: opts.variant } : {}),
    ...(opts.a11y !== undefined ? { a11y: opts.a11y } : {}),
  });
  const report = await runSpec({
    spec,
    executor,
    decision,
    ...(vision ? { vision } : {}),
    ...(opts.runs ? { runs: opts.runs } : {}),
    variant: effectiveVariant(spec, opts.variant),
    ...(opts.only ? { only: opts.only } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const checked = QaReportSchema.safeParse(report);
  if (!checked.success)
    return {
      ok: false,
      error: { kind: "io", message: `report failed validation: ${checked.error.message}` },
    };
  const htmlPath = resolve(opts.out ?? defaultReportPath(rt, specPath));
  const jsonPath = htmlPath.replace(/\.html?$/i, "") + ".json";
  try {
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, rt.secrets.redact(renderHtmlReport(report)));
    writeFileSync(jsonPath, `${rt.secrets.redact(JSON.stringify(report, null, 2))}\n`);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "io",
        message: `cannot write the report: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  return { ok: true, value: { report, htmlPath, jsonPath } };
}
