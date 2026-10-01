// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Probe: plans two testbed goals with the user's own signed-in Codex CLI through the Codex planner, from a
// text page summary (the testbed need not run). Prints each plan, its compiled predicates, latency and
// validity. Uses plan usage; never run in CI. GhostHand reads no Codex credentials.
//
//   node scripts/probe-planner.ts [--model M] [--effort low|medium|high] [--binary codex] [--json]
import { parseArgs } from "node:util";
import { createCodexConsultant, createCodexPlanner } from "@ghosthand/consultants";
import type { PlanInput, PlanOutput } from "@ghosthand/core";
import { deterministicShare } from "@ghosthand/core";
import type { Predicate } from "@ghosthand/protocol";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    effort: { type: "string", default: "low" },
    binary: { type: "string", default: process.env.CODEX_BIN ?? "codex" },
    json: { type: "boolean", default: false },
  },
});
const effort = values.effort === "medium" || values.effort === "high" ? values.effort : "low";

const shell = ["Header: GhostHand testbed | nav: link Home, link Profile, link Inbox"];

const goals: Array<{ name: string; input: PlanInput }> = [
  {
    name: "profile",
    input: {
      goal: 'On your profile, change the display name to "Alice Moreau" and the job title to "Staff Engineer", then save.',
      startUrl: "http://127.0.0.1:4400/profile",
      maxSubgoals: 8,
      allowedEffectsHint: ["advance", "commit"],
      pageSummary: [
        "Title: Profile - GhostHand testbed",
        "URL: http://127.0.0.1:4400/profile",
        ...shell,
        'heading "Profile"',
        "text: Signed in with alice@testbed.local. Your email can't be changed here.",
        'textbox "Display name" value "Alice Martin"',
        'textbox "Handle" value "alice" (hint: 3 to 20 characters: lowercase letters, digits or hyphens.)',
        'textbox "Job title" value "Engineer"',
        'textbox "Website" value "" (hint: A full https:// URL, or leave empty.)',
        'textbox "Bio" multiline value "" (hint: Up to 160 characters.)',
        'button "Save profile"',
      ].join("\n"),
    },
  },
  {
    name: "login",
    input: {
      goal: "Sign in as alice@testbed.local with the stored password [input:TESTBED_PASSWORD]",
      startUrl: "http://127.0.0.1:4400/login",
      maxSubgoals: 6,
      allowedEffectsHint: ["advance", "commit"],
      pageSummary: [
        "Title: Sign in - GhostHand testbed",
        "URL: http://127.0.0.1:4400/login",
        "Header: GhostHand testbed | link Sign in",
        'heading "Sign in"',
        "text: Use your testbed account.",
        'textbox "Email" value ""',
        'textbox "Password" (password) value ""',
        'button "Sign in"',
      ].join("\n"),
    },
  },
];

function describe(p: Predicate): string {
  switch (p.kind) {
    case "url":
      return `url ~ ${p.matches}`;
    case "visible":
      return `visible ${p.role ?? ""} "${p.name}"`;
    case "text":
      return `text "${p.text}"`;
    case "value":
      return `value "${p.name}" = "${p.value}"`;
    case "http":
      return `http ${p.method} ${p.url}`;
    case "oracle":
      return `oracle ${p.taskId}`;
    case "model":
      return `MODEL: ${p.criteria}`;
  }
}

function print(out: PlanOutput): void {
  for (const [i, s] of out.plan.subgoals.entries()) {
    const d = out.draft.subgoals[i];
    console.log(`  ${s.id}. ${s.goal}`);
    console.log(
      `     effects=${s.allowedEffects.join(",")} max_steps=${s.maxSteps} seeds=${JSON.stringify(s.seedTargets)}`,
    );
    console.log(`     done_when (model): ${JSON.stringify(d?.done_when ?? [])}`);
    console.log(
      `     compiled: all=[${s.doneWhen.all.map(describe).join("; ")}] none=[${s.doneWhen.none.map(describe).join("; ")}]`,
    );
  }
}

const consultant = createCodexConsultant({ binary: values.binary, clientVersion: "0.0.0" });
const planner = createCodexPlanner(consultant, {
  effort,
  ...(values.model === undefined ? {} : { model: values.model }),
});

const summary: Array<Record<string, unknown>> = [];
try {
  for (const { name, input } of goals) {
    console.log(`\n=== ${name}: ${input.goal}`);
    const t = performance.now();
    const r = await planner.plan(input);
    const wall = Math.round(performance.now() - t);
    if (!r.ok) {
      console.log(`  INVALID or failed after ${wall} ms: ${r.error.kind}: ${r.error.message}`);
      summary.push({ name, wallMs: wall, valid: false, error: r.error });
      continue;
    }
    const share = deterministicShare(r.value.plan);
    console.log(
      `  valid plan: ${r.value.plan.subgoals.length} subgoals, ${wall} ms wall (planner ${r.value.latencyMs} ms), deterministic predicates ${Math.round(share * 100)}%`,
    );
    print(r.value);
    summary.push({
      name,
      wallMs: wall,
      valid: true,
      subgoals: r.value.plan.subgoals.length,
      deterministicShare: share,
      draft: r.value.draft,
      plan: r.value.plan,
    });
  }
} finally {
  await planner.close();
}

if (values.json)
  console.log(`\n${JSON.stringify({ effort, model: values.model ?? "(codex default)", summary }, null, 2)}`);
