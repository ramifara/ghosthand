// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Debug view: what the agent sees on a page (the redacted element table), without any model call.
import { openRuntime, webLauncher } from "@ghosthand/engine";
import { table } from "../format.ts";
import { fail, out } from "../io.ts";

export async function observeCommand(
  url: string | undefined,
  flags: { headless: boolean; profile?: string; json: boolean },
): Promise<number> {
  if (!url) return fail("usage: ghosthand observe --url <url>", 2);
  const opened = await openRuntime({ logLevel: "silent" });
  if (!opened.ok) return fail(opened.error.message);
  const launched = await webLauncher(opened.value, {
    startUrl: url,
    headless: flags.headless,
    ...(flags.profile ? { profile: flags.profile } : {}),
  })();
  if (!launched.ok) return fail(launched.error.message);
  const { computer } = launched.value;
  try {
    const o = await computer.open(url);
    if (!o.ok) return fail(o.error.message);
    await computer.waitIdle({ capMs: 5000 });
    const t0 = performance.now();
    const snap = await computer.observe();
    const took = performance.now() - t0;
    if (!snap.ok) return fail(snap.error.message);
    const s = snap.value;
    if (flags.json) out(JSON.stringify(s, null, 2));
    else {
      out(
        `${s.title} · ${s.url ?? ""} · ${s.elements.length} elements · ~${s.tokenEstimate} tokens · quality ${s.quality.score.toFixed(2)} · ${Math.round(took)} ms`,
      );
      out(
        table([
          ["ID", "ROLE", "NAME", "VALUE", "REGION", "RISK", "OPS", "CONTEXT"],
          ...s.elements.map((e) => [
            e.token,
            e.role,
            e.name.slice(0, 40),
            e.value ?? "",
            e.region,
            e.risk,
            e.actions.join(","),
            (e.context ?? "").slice(0, 40),
          ]),
        ]),
      );
    }
    return 0;
  } finally {
    await launched.value.close();
  }
}
