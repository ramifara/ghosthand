// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Human approval for "commit" actions the subgoal did not pre-approve. Never auto-approved without a TTY.
import { createInterface } from "node:readline/promises";
import type { ApprovalRequest } from "@ghosthand/core";

export function describeApproval(req: ApprovalRequest): string {
  const target = req.element ? `${req.element.role} "${req.element.name}"` : "(no target)";
  const ctx = req.element?.context ? ` [${req.element.context.slice(0, 80)}]` : "";
  return `step ${req.step}: ${req.action.type} ${target}${ctx}, effect ${req.effect}, goal: ${req.subgoal.goal}`;
}

export interface ApproverOptions {
  /** --yes: approve everything (for unattended testbed runs). */
  yes: boolean;
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  output?: NodeJS.WritableStream;
}

export function createApprover(opts: ApproverOptions): (req: ApprovalRequest) => Promise<boolean> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stderr;
  return async (req) => {
    if (opts.yes) {
      output.write(`approved (--yes): ${describeApproval(req)}\n`);
      return true;
    }
    if (!input.isTTY) {
      output.write(`denied (no terminal to ask; pass --yes to allow): ${describeApproval(req)}\n`);
      return false;
    }
    const rl = createInterface({ input, output });
    try {
      const answer = await rl.question(`Approve ${describeApproval(req)}? [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  };
}
