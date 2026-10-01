// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand recipes list|show|export|remove` and `ghosthand map`: the knowledge base (ADR 0010).
import { writeFileSync } from "node:fs";
import { exportPlaywrightSpec, openKnowledgeFor, openRuntime } from "@ghosthand/engine";
import { bindValue, effectiveTrust, type Knowledge, type Recipe } from "@ghosthand/knowledge";
import { TaskSpec } from "@ghosthand/protocol";
import { table } from "../format.ts";
import { fail, out } from "../io.ts";

async function open(): Promise<Knowledge | string> {
  const rt = await openRuntime({ logLevel: "silent" });
  if (!rt.ok) return rt.error.message;
  return openKnowledgeFor(rt.value) ?? "cannot open the knowledge database";
}

const age = (ms: number | undefined): string => {
  if (ms === undefined) return "-";
  const d = (Date.now() - ms) / 86_400_000;
  return d < 1 ? "today" : `${Math.floor(d)}d`;
};

/** The recipe as a task with its example parameters, for export. */
export function recipeTask(r: Recipe): TaskSpec {
  const params = Object.fromEntries(r.params.map((p) => [p.name, p.example]));
  return TaskSpec.parse({
    id: r.taskId ?? "adhoc",
    instruction: bindValue(r.intent, params),
    startUrl: r.startUrl,
    secrets: r.secrets,
    ...(r.plan ? { plan: bindValue(r.plan, params) } : {}),
  });
}

export async function recipesCommand(
  args: string[],
  flags: { json: boolean; out?: string; app?: string },
): Promise<number> {
  const [sub, id] = args;
  const kb = await open();
  if (typeof kb === "string") return fail(kb);
  try {
    switch (sub ?? "list") {
      case "list": {
        const r = kb.recipes.list(flags.app ? { app: flags.app } : {});
        if (!r.ok) return fail(r.error.message);
        if (flags.json) out(JSON.stringify(r.value, null, 2));
        else if (r.value.length === 0) out("No recipes yet. Run a task with --learn to create one.");
        else
          out(
            table([
              ["ID", "V", "STATUS", "TRUST", "OK", "FAIL", "HEALS", "STEPS", "PARAMS", "LAST OK"],
              ...r.value.map((x) => [
                x.id,
                String(x.version),
                x.status,
                effectiveTrust(x, Date.now()).toFixed(2),
                String(x.successes),
                String(x.failures),
                String(x.heals),
                String(x.steps.length),
                x.params.map((p) => p.name).join(",") || "-",
                age(x.lastSuccessAt),
              ]),
            ]),
          );
        return 0;
      }
      case "show": {
        if (!id) return fail("usage: ghosthand recipes show <id>", 2);
        const r = kb.recipes.get(id);
        if (!r.ok) return fail(r.error.message);
        const x = r.value;
        if (flags.json) {
          out(JSON.stringify(x, null, 2));
          return 0;
        }
        out(`${x.id} v${x.version} (${x.status}, trust ${effectiveTrust(x, Date.now()).toFixed(2)})`);
        out(`intent: ${x.intent}`);
        out(`params: ${x.params.map((p) => `${p.name}=${JSON.stringify(p.example)}`).join(", ") || "none"}`);
        out(`start: ${x.startUrl} (screen ${x.startScreen.key})`);
        x.steps.forEach((s, i) => {
          const t = s.target ? `${s.target.role} "${s.target.name}"` : "";
          const v =
            s.action.type === "set_value"
              ? ` ← ${typeof s.action.value === "string" ? JSON.stringify(s.action.value) : `[input:${s.action.value.secretRef}]`}`
              : "";
          out(`  ${i + 1}. ${s.action.type} ${t}${v}${s.effect === "commit" ? " (commit)" : ""}`);
        });
        out(`learned from: ${x.learnedFrom.join(", ")}`);
        return 0;
      }
      case "export": {
        if (!id) return fail("usage: ghosthand recipes export <id> [--out file.spec.ts]", 2);
        const r = kb.recipes.get(id);
        if (!r.ok) return fail(r.error.message);
        const params = Object.fromEntries(r.value.params.map((p) => [p.name, p.example]));
        const spec = exportPlaywrightSpec(
          recipeTask(r.value),
          r.value.steps.map((s, i) => ({
            step: i + 1,
            action: bindValue(s.action, params),
            target: s.target,
          })),
        );
        if (flags.out) {
          writeFileSync(flags.out, spec);
          out(`wrote ${flags.out}`);
        } else out(spec);
        return 0;
      }
      case "remove": {
        if (!id) return fail("usage: ghosthand recipes remove <id>", 2);
        const r = kb.recipes.remove(id);
        if (!r.ok) return fail(r.error.message);
        out(r.value ? `removed ${id}` : `no recipe ${id}`);
        return r.value ? 0 : 1;
      }
      default:
        return fail(`unknown recipes command "${sub}" (list, show, export, remove)`, 2);
    }
  } finally {
    kb.close();
  }
}

export async function mapCommand(flags: { json: boolean; app?: string }): Promise<number> {
  const kb = await open();
  if (typeof kb === "string") return fail(kb);
  try {
    const screens = kb.appMap.screens(flags.app);
    if (!screens.ok) return fail(screens.error.message);
    if (flags.json) {
      out(JSON.stringify(screens.value, null, 2));
      return 0;
    }
    if (screens.value.length === 0) {
      out("The app map is empty. Run tasks with --learn to map screens.");
      return 0;
    }
    const apps = [...new Set(screens.value.map((s) => s.app))];
    for (const app of apps) {
      const own = screens.value.filter((s) => s.app === app);
      const t = kb.appMap.transitions(app);
      out(`${app}: ${own.length} screens, ${t.ok ? t.value.length : 0} transitions`);
      out(
        table([
          ["SCREEN", "URL PATTERN", "TITLE", "VISITS", "CONTROLS"],
          ...own.map((s) => [
            s.key,
            s.urlPattern.replace(app, ""),
            s.title.slice(0, 30),
            String(s.visits),
            String(s.controls.length),
          ]),
        ]),
      );
    }
    return 0;
  } finally {
    kb.close();
  }
}
