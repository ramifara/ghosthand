// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Single-file HTML report: inline CSS, light and dark from the device theme, no JavaScript (sections fold
// with <details>). Screenshot thumbnails are inlined as data URIs; model inputs are listed as file paths.
import type { CaseRun, ExpectResult, QaReport, StepResult } from "./report-schema.ts";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ms = (n: number): string =>
  n >= 10_000
    ? `${(n / 1000).toFixed(0)} s`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)} s`
      : `${Math.round(n)} ms`;
const usd = (n: number): string => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(3)}`);
const pct = (n: number | undefined): string => (n === undefined ? "–" : `${Math.round(n * 100)}%`);

const CSS = `
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1c1d1f;--muted:#5d6168;--line:#e2e3e5;--card:#fff;--accent:#0f766e;
--pass:#15803d;--fail:#b91c1c;--warn:#a16207;--info:#4b5563;--chip:#f1f2f3;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#121315;--fg:#e6e7e9;--muted:#9ca0a8;--line:#2a2c30;--card:#1a1b1e;--accent:#2dd4bf;
--pass:#4ade80;--fail:#f87171;--warn:#facc15;--info:#9ca3af;--chip:#24262a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 20px 64px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}
h3{font-size:14px;margin:0}code,.mono{font-family:var(--mono);font-size:12.5px}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:10px 0}
.head{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.score{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-weight:600;font-size:12px;border:1px solid currentColor}
.PASS,.passed,.satisfied{color:var(--pass)}.FAIL,.failed,.unsatisfied{color:var(--fail)}.BLOCKED,.blocked{color:var(--warn)}
.INCONCLUSIVE,.inconclusive,.unknown{color:var(--info)}.advisory{color:var(--accent)}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-top:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;border-top:none}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.bar{height:6px;background:var(--chip);border-radius:3px;min-width:80px}.bar>i{display:block;height:6px;border-radius:3px;background:var(--accent)}
.chip{display:inline-block;background:var(--chip);border-radius:4px;padding:0 6px;font-size:12px;margin:1px 2px 1px 0}
details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}
details>summary:before{content:"▸ ";color:var(--muted)}details[open]>summary:before{content:"▾ "}
img.thumb{width:160px;border:1px solid var(--line);border-radius:4px;display:block}ul.exp{margin:4px 0 0;padding-left:16px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px}a{color:var(--accent)}
@media (prefers-reduced-motion:no-preference){details[open]>*:not(summary){animation:none}}
`;

function badge(v: string): string {
  return `<span class="badge ${esc(v)}">${esc(v)}</span>`;
}

function expectList(xs: ExpectResult[]): string {
  if (xs.length === 0) return "";
  return `<ul class="exp">${xs
    .map(
      (e) =>
        `<li><span class="${e.state}">${e.state === "satisfied" ? "✓" : e.state === "unsatisfied" ? "✗" : "?"}</span> ${esc(e.source)} <span class="muted">· ${esc(e.decidedBy)}${e.confidence !== undefined ? ` ${pct(e.confidence)}` : ""} · ${esc(e.detail)}${e.line > 0 ? ` · line ${e.line}` : ""}</span></li>`,
    )
    .join("")}</ul>`;
}

function evidenceCell(s: StepResult, folder: string | undefined): string {
  const parts: string[] = [];
  if (s.evidence.thumbnail)
    parts.push(`<img class="thumb" alt="Screenshot after step ${s.index}" src="${s.evidence.thumbnail}">`);
  const files = [
    ...(s.evidence.screenshotFile ? [s.evidence.screenshotFile] : []),
    ...s.evidence.modelInputs,
  ];
  for (const f of files) parts.push(`<div class="mono muted">${esc(f)}</div>`);
  if (files.length > 0 && folder)
    parts.push(`<div class="muted" style="font-size:11px">in ${esc(folder)}</div>`);
  return parts.join("");
}

function stepRows(run: CaseRun): string {
  return run.steps
    .map(
      (s) => `<tr>
<td class="num">${s.index}</td>
<td><div>${esc(s.perform)}</div>${expectList(s.expects)}<div class="muted" style="margin-top:4px">${esc(s.detail)}</div></td>
<td>${badge(s.status)}<div class="muted" style="margin-top:4px">${esc(s.flag)}${s.decisive ? "" : " (advisory)"}</div></td>
<td>${esc(s.decidedBy)}<div class="muted">${pct(s.confidence)}</div></td>
<td class="num">${s.agentSteps} steps<br>${ms(s.wallMs)}<br>${s.inputTokens.toLocaleString("en")} tok<br>${usd(s.costUsd)}</td>
<td>${evidenceCell(s, run.folder)}</td></tr>`,
    )
    .join("");
}

function runBlock(run: CaseRun): string {
  const a11y = run.a11y.flatMap((p) => p.violations.map((v) => ({ ...v, url: p.url })));
  const errors = [
    ...run.consoleErrors.map((e) => `console: ${e}`),
    ...run.httpErrors.map((h) => `HTTP ${h.status} ${h.url}`),
  ];
  return `<details ${run.verdict === "PASS" ? "" : "open"} class="card"><summary><h3 style="display:inline">Run ${run.run} ${badge(run.verdict)}</h3>
<span class="muted"> ${esc(run.outcome)} · ${run.agentSteps} agent steps · ${ms(run.wallMs)} · ${run.inputTokens.toLocaleString("en")} tokens · ${usd(run.costUsd)} · ${run.decisionCalls} Jev / ${run.modelCalls} LLM calls${run.runId ? ` · run <code>${esc(run.runId)}</code>` : ""}</span></summary>
<p class="muted">${esc(run.reason)}</p>
<table><thead><tr><th>#</th><th>Step and expectations</th><th>Status</th><th>Decided by</th><th>Cost</th><th>Evidence</th></tr></thead><tbody>${stepRows(run)}</tbody></table>
${run.caseExpects.length > 0 ? `<h3 style="margin-top:12px">Case checks (after the last step)</h3>${expectList(run.caseExpects)}` : ""}
<div class="kv" style="margin-top:12px">
<span class="muted">UX (Jev score, advisory)</span><span>${run.ux.map((u) => `<span class="chip" title="${esc(u.question)}">${esc(u.key)} ${u.score === undefined ? "n/a" : pct(u.score)}</span>`).join("") || "–"}</span>
<span class="muted">Visual</span><span>${run.visual ? `${pct(run.visual.score)} <span class="muted">${esc(run.visual.model)}${run.visual.issues.length ? `: ${esc(run.visual.issues.join("; "))}` : ""}</span>` : "not measured"}</span>
<span class="muted">Errors</span><span>${errors.length === 0 ? "none captured" : errors.map((e) => `<div class="mono">${esc(e.slice(0, 200))}</div>`).join("")}</span>
<span class="muted">Accessibility</span><span>${
    run.a11y.length === 0
      ? "not audited"
      : a11y.length === 0
        ? `no axe violations on ${run.a11y.length} page(s)`
        : a11y
            .map(
              (v) =>
                `<div><span class="chip">${esc(v.impact ?? "n/a")}</span> <a href="${esc(v.helpUrl)}">${esc(v.id)}</a> ${esc(v.help)} <span class="muted">(${v.nodes} node(s), ${esc(v.url)})</span></div>`,
            )
            .join("")
  }</span>
</div>
${run.finalEvidence?.thumbnail ? `<div style="margin-top:10px"><span class="muted">Final screen</span><img class="thumb" alt="Final screen of run ${run.run}" src="${run.finalEvidence.thumbnail}"></div>` : ""}
</details>`;
}

export function renderHtmlReport(report: QaReport): string {
  const title = `GhostHand QA: ${report.spec.suites.join(", ")}`;
  const rubric = report.rubric
    .map(
      (
        r,
      ) => `<tr><td>${esc(r.label)}</td><td class="num">${r.points === undefined ? "–" : r.points}</td><td class="num">${r.weight}</td>
<td><div class="bar"><i style="width:${r.points === undefined ? 0 : Math.round((100 * r.points) / r.weight)}%"></i></div></td><td class="muted">${esc(r.detail)}</td></tr>`,
    )
    .join("");
  const bugs =
    report.plantedBugs.length === 0
      ? `<p class="muted">The spec declares no planted bugs.</p>`
      : `<table><thead><tr><th>Bug flag</th><th>Active</th><th>Expected to catch it</th><th>Result</th><th>Decided by</th></tr></thead><tbody>${report.plantedBugs
          .map(
            (b) =>
              `<tr><td><code>${esc(b.flag)}</code></td><td>${b.active ? "yes" : "no"}</td><td>${esc(b.expectedCase)}</td><td>${
                b.active
                  ? `${b.caught ? badge("caught") : badge("missed")} ${b.caughtRuns}/${b.runs} runs failed`
                  : `control run: ${b.caughtRuns}/${b.runs} runs failed`
              }</td><td>${esc(b.decidedBy ?? "–")}</td></tr>`,
          )
          .join("")}</tbody></table>`;
  const cases = report.cases
    .map(
      (
        c,
      ) => `<section class="card"><div class="head"><h3>${esc(c.suite)} / ${esc(c.title)}</h3>${badge(c.verdict)}
<span class="muted">${c.passes}/${c.runs.length} runs passed · spec line ${c.line} · preflight ${c.preflight.flags.map((f, i) => `${i + 1}:${f}×${c.preflight.actions[i] ?? 1}`).join(" ")}${c.preflight.answered ? "" : " (defaults)"}${c.preflight.error ? ` · ${esc(c.preflight.error)}` : ""}</span></div>
${c.notes.length > 0 ? `<p class="muted">${c.notes.map(esc).join("<br>")}</p>` : ""}
${c.runs.map(runBlock).join("")}</section>`,
    )
    .join("");
  const variant = Object.entries(report.variant)
    .map(([k, v]) => `<span class="chip">${esc(k)}=${esc(String(v))}</span>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><main>
<header class="card"><div class="head"><div><h1>${esc(title)}</h1>
<div class="muted">${esc(report.spec.path ?? "")} · ${esc(report.spec.url)} · ${esc(report.startedAt)} · decision ${esc(report.decisionModel)}${report.visionModel ? ` · vision ${esc(report.visionModel)}` : ""} · ${report.runsPerCase} run(s) per case ${variant}</div></div>
<div style="margin-left:auto;text-align:right"><div class="score">${report.score}<span class="muted" style="font-size:16px">/100</span></div>${badge(report.verdict)}</div></div>
<p class="mono" style="margin:10px 0 0">${esc(report.summaryLine)}</p>
<p class="muted" style="margin:6px 0 0">Total ${ms(report.totals.wallMs)} · ${report.totals.inputTokens.toLocaleString("en")} input tokens · ${usd(report.totals.costUsd)} · ${report.totals.decisionCalls} Jev calls · ${report.totals.modelCalls} LLM calls</p></header>
<h2>Rubric</h2><div class="card"><table><thead><tr><th>Item</th><th>Points</th><th>Weight</th><th></th><th>Detail</th></tr></thead><tbody>${rubric}</tbody></table>
<p class="muted">Task success is a gate: any failed decisive step makes the verdict FAIL whatever the score. UX friction scores are Jev's and never decide a verdict. Unmeasured items are left out and the score is scaled over the rest.</p></div>
<h2>Planted bugs</h2><div class="card">${bugs}</div>
<h2>Cases</h2>${cases}
<p class="muted">Statuses: passed, failed (decisive), blocked (not reached), inconclusive (no oracle could decide), advisory (preflight flagged the step transient, derived or external). Decided by: deterministic (code on the page or API), oracle (testbed DB), jev (holds noul, separate request), vision (screenshot review), none.</p>
</main></body></html>
`;
}
