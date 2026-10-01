// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Modes D1 and D2 (research note §1.1, §1.4): vision steps for screens the element table cannot serve.
// - D1 screen-to-text: a vision model names unnamed controls from their boxes; Jev then chooses as usual.
// - D1 ground: a vision model points at the target; the loop clicks that point on the same capture.
// - D2 drive: a provider computer-use tool proposes one action at a time, for at most 8 steps, until the
//   element table is good again. Provider safety checks always stop for a human; text to type must be a
//   literal from the goal or a stored secret, never text the model read off the page.
import type { Action, ActionResult, Computer, EffectClass, Snapshot } from "@ghosthand/protocol";
import type { EventSink } from "./event-sink.ts";
import type { TextOption } from "./literals.ts";
import type { Clock } from "./logger.ts";
import type { SecretsRegistry } from "./secrets.ts";
import type { HistoryEntry } from "./state-builder.ts";
import type { DriveAction, VisionAssist, VisionScreenshot } from "./vision.ts";

export interface ModeDEnv {
  computer: Computer;
  events: EventSink;
  vision: VisionAssist;
  secrets: SecretsRegistry;
  clock: Clock;
  step: number;
  goal: string;
  history: HistoryEntry[];
  /** Literal and secret texts the goal allows typing (D2). */
  textOptions: readonly TextOption[];
  signal?: AbortSignal;
  onModelCall: (costUsd: number) => void;
}

/** A screenshot for a vision call, tied to the driver's capture id. */
export async function captureFor(computer: Computer): Promise<VisionScreenshot | undefined> {
  const shot = await computer.screenshot();
  if (!shot.ok) return undefined;
  const c = shot.value.capture;
  return { captureId: c.id, data: shot.value.data, width: c.width, height: c.height, mediaType: c.mimeType };
}

function modelCall(
  env: ModeDEnv,
  role: string,
  r:
    | { ok: true; value: { model: string; latencyMs: number; costUsd: number } }
    | { ok: false; error: { kind: string; message: string } },
  summary: string,
): void {
  env.onModelCall(r.ok ? r.value.costUsd : 0);
  env.events.emit({
    type: "model.call",
    step: env.step,
    role,
    model: r.ok ? r.value.model : env.vision.id,
    latencyMs: r.ok ? r.value.latencyMs : 0,
    ...(r.ok ? { costUsd: r.value.costUsd } : {}),
    ok: r.ok,
    summary: env.secrets.redact(r.ok ? summary : `${r.error.kind}: ${r.error.message}`),
  });
}

/** Unnamed interactive elements with usable boxes (the D1 screen-to-text targets). */
export function unnamedTargets(snapshot: Snapshot, limit = 30) {
  return snapshot.elements
    .filter((e) => e.actions.length > 0 && e.name.trim() === "" && (e.visibleBounds ?? e.bounds))
    .slice(0, limit);
}

/**
 * D1 screen-to-text: asks the vision model to name unnamed controls. Returns the snapshot with names filled
 * in (context marks them as read by vision), or undefined when nothing could be named.
 */
export async function nameUnnamed(env: ModeDEnv, snapshot: Snapshot): Promise<Snapshot | undefined> {
  const targets = unnamedTargets(snapshot);
  if (targets.length === 0) return undefined;
  const screenshot = await captureFor(env.computer);
  if (!screenshot) return undefined;
  const r = await env.vision.nameElements({
    screenshot,
    elements: targets.map((e) => ({
      token: e.token,
      role: e.role,
      box: e.visibleBounds ?? e.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    })),
    goal: env.goal,
    ...(env.signal ? { signal: env.signal } : {}),
  });
  const named = r.ok ? Object.values(r.value.names).filter((n) => n.trim() !== "").length : 0;
  modelCall(env, "vision_grounder", r, `named ${named} of ${targets.length} unlabeled controls`);
  if (!r.ok || named === 0) return undefined;
  // Names come from pixels, so they are evidence like any page text: redacted, short, single-line.
  const clean = (s: string) => env.secrets.redact(s.replace(/\s+/g, " ").trim()).slice(0, 80);
  return {
    ...snapshot,
    elements: snapshot.elements.map((e) => {
      const name = r.value.names[e.token];
      if (!name || e.name.trim() !== "") return e;
      return {
        ...e,
        name: clean(name),
        context: [e.context, "name read from the screen by vision"].filter(Boolean).join(" · "),
      };
    }),
  };
}

/** D1 ground: point at `instruction` and click it on the same capture. */
export async function groundAndClick(
  env: ModeDEnv,
  instruction: string,
  effect: EffectClass,
): Promise<{ result?: ActionResult; reason: string }> {
  const screenshot = await captureFor(env.computer);
  if (!screenshot) return { reason: "screenshot failed" };
  const r = await env.vision.ground({
    screenshot,
    instruction,
    ...(env.signal ? { signal: env.signal } : {}),
  });
  modelCall(
    env,
    "vision_grounder",
    r,
    r.ok
      ? r.value.found
        ? `point (${Math.round(r.value.x)}, ${Math.round(r.value.y)})`
        : `not found: ${r.value.reason}`
      : "",
  );
  if (!r.ok) return { reason: `vision ${r.error.kind}` };
  if (!r.value.found) return { reason: `vision did not find it: ${r.value.reason}` };
  const action: Action = {
    type: "click",
    target: { captureId: screenshot.captureId, x: r.value.x, y: r.value.y },
  };
  env.events.emit({ type: "action", step: env.step, action, effectClass: effect, mode: "D1" });
  const t = env.clock.now();
  const result = await env.computer.click(action.target);
  env.events.emit({ type: "effect", step: env.step, result });
  env.history.push({
    step: env.step,
    text: `clicked a point found by vision for: ${instruction.slice(0, 120)} (${result.effect})`,
  });
  return { result, reason: `clicked in ${env.clock.now() - t} ms` };
}

/** Text a D2 action may type: a goal literal or a stored secret placeholder, nothing read off the page. */
export function allowedText(
  text: string,
  options: readonly TextOption[],
): { value: string } | { secretRef: string } | undefined {
  const t = text.trim();
  const secret = /^\[input:([A-Za-z0-9_.-]+)\]$/.exec(t);
  if (secret?.[1]) {
    const name = secret[1];
    return options.some((o) => o.kind === "secret" && o.name === name) ? { secretRef: name } : undefined;
  }
  return options.some((o) => o.kind === "literal" && o.text === t) ? { value: t } : undefined;
}

export type DriveOutcome =
  | { kind: "acted"; result: ActionResult }
  | { kind: "done"; reason: string }
  | { kind: "safety"; reason: string }
  | { kind: "failed"; reason: string };

/** Maps a D2 action to a Computer action on the capture (undefined for done/safety/disallowed text). */
export function driveToAction(
  a: DriveAction,
  captureId: string,
  options: readonly TextOption[],
): Action | string {
  switch (a.kind) {
    case "click":
      return {
        type: "click",
        target: { captureId, x: a.x, y: a.y },
        ...(a.button ? { button: a.button } : {}),
        ...(a.count ? { count: a.count } : {}),
      };
    case "type": {
      const text = allowedText(a.text, options);
      if (!text) return "the model wanted to type text that is neither in the goal nor a stored secret";
      return { type: "type_text", text: "secretRef" in text ? { secretRef: text.secretRef } : text.value };
    }
    case "key":
      return { type: "key", keys: a.keys };
    case "scroll":
      return { type: "scroll", dx: a.dx, dy: a.dy, target: { captureId, x: a.x, y: a.y } };
    case "drag":
      return { type: "drag", from: { captureId, ...a.from }, to: { captureId, ...a.to } };
    default:
      return `no action (${a.kind})`;
  }
}

/** One D2 step: screenshot → provider computer tool → one action. */
export async function driveStep(
  env: ModeDEnv,
  execute: (computer: Computer, action: Action) => Promise<ActionResult>,
): Promise<DriveOutcome> {
  const drive = env.vision.drive?.bind(env.vision);
  if (!drive) return { kind: "failed", reason: "the vision provider has no computer-use model" };
  const screenshot = await captureFor(env.computer);
  if (!screenshot) return { kind: "failed", reason: "screenshot failed" };
  const r = await drive({
    screenshot,
    goal: env.goal,
    history: env.history.slice(-8).map((h) => h.text),
    ...(env.signal ? { signal: env.signal } : {}),
  });
  modelCall(env, "vision_driver", r, r.ok ? r.value.action.kind : "");
  if (!r.ok) return { kind: "failed", reason: `vision ${r.error.kind}: ${r.error.message}` };
  const a = r.value.action;
  if (a.kind === "safety") return { kind: "safety", reason: a.reason };
  if (a.kind === "done") return { kind: "done", reason: a.reason };
  const action = driveToAction(a, screenshot.captureId, env.textOptions);
  if (typeof action === "string") return { kind: "failed", reason: action };
  env.events.emit({ type: "action", step: env.step, action, effectClass: "advance", mode: "D2" });
  const result = await execute(env.computer, action);
  env.events.emit({ type: "effect", step: env.step, result });
  env.history.push({ step: env.step, text: `vision drove: ${a.kind} (${result.effect})` });
  return { kind: "acted", result };
}
