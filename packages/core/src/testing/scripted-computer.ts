// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// An in-memory Computer driven by a screen graph: each screen is a snapshot, and a transition function
// maps an executed action to the next screen. Used by loop, mode A and mode D tests.
import type {
  Action,
  ActionResult,
  Capture,
  Computer,
  ComputerError,
  Element,
  FieldValue,
  PointerTarget,
  PredicateResult,
  Result,
  Snapshot,
} from "@ghosthand/protocol";
import { ok } from "@ghosthand/protocol";

export interface ScriptedScreen {
  url: string;
  title: string;
  text?: string;
  elements: Element[];
  canScroll?: boolean;
}

/** Returns the next screen id, or undefined when the action changes nothing. */
export type ScriptedTransition = (action: Action, screen: string) => string | undefined;

export interface ScriptedComputerOptions {
  screens: Record<string, ScriptedScreen>;
  start: string;
  transition: ScriptedTransition;
}

export function fakeElement(
  token: string,
  partial: Partial<Element> & Pick<Element, "role" | "name">,
): Element {
  const roleClass: Element["roleClass"] =
    partial.role === "button"
      ? "button"
      : partial.role === "textbox"
        ? "textbox"
        : partial.role === "link"
          ? "link"
          : partial.role === "heading"
            ? "heading"
            : "other";
  return {
    token,
    stableId: `${partial.role}|${partial.name}`,
    roleClass,
    nativeRole: partial.role,
    states: [],
    actions: partial.role === "heading" ? [] : ["press"],
    bounds: { x: 10, y: 10, width: 80, height: 20 },
    visibleBounds: { x: 10, y: 10, width: 80, height: 20 },
    boundsTrust: "exact",
    region: "main",
    frame: "main",
    risk: "safe",
    ...partial,
  };
}

const result = (effect: ActionResult["effect"], extra: Partial<ActionResult> = {}): ActionResult => ({
  effect,
  route: "semantic",
  evidence: [],
  invalidatedSnapshots: [],
  durationMs: 1,
  ...extra,
});

export class ScriptedComputer implements Computer {
  screen: string;
  readonly actions: Action[] = [];
  readonly opened: string[] = [];
  readonly values = new Map<string, FieldValue>();
  observations = 0;
  screenshots = 0;
  readonly #opts: ScriptedComputerOptions;
  #captures = new Set<string>();

  constructor(opts: ScriptedComputerOptions) {
    this.#opts = opts;
    this.screen = opts.start;
  }

  capabilities() {
    return {
      surface: "web" as const,
      semanticActions: true,
      pointer: true,
      screenshots: true,
      recording: false,
    };
  }
  async doctor() {
    return [{ name: "scripted", ok: true, detail: "in-memory" }];
  }
  async open(target: string): Promise<Result<void, ComputerError>> {
    this.opened.push(target);
    this.screen = this.#opts.start;
    return ok(undefined);
  }
  #current(): ScriptedScreen {
    const s = this.#opts.screens[this.screen];
    if (!s) throw new Error(`scripted computer: unknown screen ${this.screen}`);
    return s;
  }
  async observe(): Promise<Result<Snapshot, ComputerError>> {
    this.observations++;
    const s = this.#current();
    const elements = s.elements.map((e) => {
      const v = this.values.get(e.stableId);
      return v === undefined ? e : { ...e, value: typeof v === "string" ? v : `[input:${v.secretRef}]` };
    });
    const unnamed = elements.filter((e) => e.actions.length > 0 && e.name.trim() === "").length;
    const interactive = elements.filter((e) => e.actions.length > 0).length;
    return ok({
      id: `s${this.observations}`,
      surface: "web",
      takenAt: this.observations,
      url: s.url,
      title: s.title,
      viewport: { x: 0, y: 0, width: 1280, height: 860 },
      elements,
      text: s.text ?? "",
      tokenEstimate: 200,
      quality: {
        elementCount: elements.length,
        unnamedInteractive: unnamed,
        score: interactive === 0 ? 1 : (interactive - unnamed) / interactive,
      },
      narrowed: false,
      ...(s.canScroll ? { canScroll: true } : {}),
    });
  }
  async screenshot(): Promise<Result<{ capture: Capture; data: Uint8Array }, ComputerError>> {
    this.screenshots++;
    const id = `c${this.screenshots}`;
    this.#captures.add(id);
    return ok({
      capture: { id, takenAt: this.screenshots, mimeType: "image/png", width: 1280, height: 860, scale: 1 },
      data: new Uint8Array([137, 80, 78, 71]),
    });
  }
  #act(action: Action): ActionResult {
    this.actions.push(action);
    const tokenOf = (t: PointerTarget | undefined) => (t && "token" in t ? t.token : undefined);
    const token =
      "token" in action ? action.token : action.type === "click" ? tokenOf(action.target) : undefined;
    if (token !== undefined && !this.#current().elements.some((e) => e.token === token))
      return result("refused", { error: { kind: "stale_token", message: token } });
    if (
      action.type === "click" &&
      "captureId" in action.target &&
      !this.#captures.has(action.target.captureId)
    )
      return result("refused", { error: { kind: "stale_token", message: "unknown capture" } });
    const next = this.#opts.transition(action, this.screen);
    if (next === undefined) return result("suspected_noop");
    this.screen = next;
    return result("confirmed", { evidence: [{ kind: "state", after: next }] });
  }
  async press(token: string) {
    return this.#act({ type: "press", token });
  }
  async setValue(token: string, value: FieldValue) {
    const el = this.#current().elements.find((e) => e.token === token);
    if (el) this.values.set(el.stableId, value);
    const r = this.#act({ type: "set_value", token, value });
    return r.effect === "suspected_noop" && el ? result("confirmed") : r;
  }
  async toggle(token: string, checked?: boolean) {
    return this.#act({ type: "toggle", token, ...(checked === undefined ? {} : { checked }) });
  }
  async selectOption(token: string, option: string) {
    return this.#act({ type: "select_option", token, option });
  }
  async focus(token: string) {
    return this.#act({ type: "focus", token });
  }
  async scrollIntoView(token: string) {
    return this.#act({ type: "scroll_into_view", token });
  }
  async selectText(token: string, text: string) {
    return this.#act({ type: "select_text", token, text });
  }
  async click(target: PointerTarget, opts?: { button?: "left" | "right" | "middle"; count?: number }) {
    return this.#act({ type: "click", target, ...(opts?.button ? { button: opts.button } : {}) });
  }
  async move(target: PointerTarget) {
    return this.#act({ type: "move", target });
  }
  async drag(from: PointerTarget, to: PointerTarget) {
    return this.#act({ type: "drag", from, to });
  }
  async scroll(dx: number, dy: number, target?: PointerTarget) {
    return this.#act({ type: "scroll", dx, dy, ...(target ? { target } : {}) });
  }
  async typeText(text: FieldValue) {
    return this.#act({ type: "type_text", text });
  }
  async key(keys: string[]) {
    return this.#act({ type: "key", keys });
  }
  async verify(): Promise<PredicateResult[]> {
    return [];
  }
  async waitIdle() {
    return { waitedMs: 0, reason: "idle" };
  }
  async startRecording(): Promise<Result<void, ComputerError>> {
    return ok(undefined);
  }
  async stopRecording(): Promise<Result<{ files: string[] }, ComputerError>> {
    return ok({ files: [] });
  }
  async close(): Promise<void> {}
}
