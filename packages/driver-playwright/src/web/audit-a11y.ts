// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Accessibility audit of the current page with axe-core (MPL-2.0, used unmodified as a dependency).
// The script is evaluated in the page, run once, and only rule ids, impacts and node counts come back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { Page } from "playwright-core";
import { z } from "zod";

export const A11yAuditViolation = z.object({
  id: z.string(),
  impact: z.enum(["minor", "moderate", "serious", "critical"]).nullable(),
  help: z.string(),
  helpUrl: z.string(),
  nodes: z.number().int().nonnegative(),
});
export type A11yAuditViolation = z.infer<typeof A11yAuditViolation>;

export interface A11yAudit {
  url: string;
  violations: A11yAuditViolation[];
  durationMs: number;
}

export type A11yAuditError = { kind: "unavailable" | "failed"; message: string };

let axeSource: string | undefined;

function loadAxe(): Result<string, A11yAuditError> {
  if (axeSource !== undefined) return ok(axeSource);
  try {
    const require = createRequire(import.meta.url);
    axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    return ok(axeSource);
  } catch (e) {
    return err({
      kind: "unavailable",
      message: `axe-core not found: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

const Raw = z.array(
  z.object({
    id: z.string(),
    impact: z.string().nullish(),
    help: z.string(),
    helpUrl: z.string(),
    nodes: z.number(),
  }),
);

const IMPACTS = new Set(["minor", "moderate", "serious", "critical"]);

/** Runs axe (WCAG 2.x A/AA rules) on the page's main frame. */
export async function auditA11y(
  page: Page,
  opts: { timeoutMs?: number } = {},
): Promise<Result<A11yAudit, A11yAuditError>> {
  const source = loadAxe();
  if (!source.ok) return source;
  const started = performance.now();
  try {
    const loaded = await page.evaluate("typeof window.axe === 'object'");
    if (loaded !== true) await page.evaluate(source.value);
    const run = page.evaluate(`(async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
        resultTypes: ["violations"],
      });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length }));
    })()`);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), opts.timeoutMs ?? 10_000),
    );
    const raw = await Promise.race([run, timeout]);
    if (raw === "timeout") return err({ kind: "failed", message: "axe timed out" });
    const parsed = Raw.safeParse(raw);
    if (!parsed.success) return err({ kind: "failed", message: "unexpected axe result" });
    return ok({
      url: page.url(),
      violations: parsed.data.map((v) => ({
        id: v.id,
        impact: v.impact && IMPACTS.has(v.impact) ? (v.impact as A11yAuditViolation["impact"]) : null,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes,
      })),
      durationMs: performance.now() - started,
    });
  } catch (e) {
    return err({
      kind: "failed",
      message: e instanceof Error ? (e.message.split("\n")[0] ?? e.message) : String(e),
    });
  }
}
