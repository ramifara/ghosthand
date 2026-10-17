// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// An in-memory Computer that simulates a login page, for loop tests without a browser.
import type {
  ActionResult,
  Computer,
  ComputerError,
  Element,
  FieldValue,
  PredicateResult,
  Result,
  Snapshot,
} from "@ghosthand/protocol";
import { ok } from "@ghosthand/protocol";
import type { SecretsRegistry } from "../secrets.ts";

const el = (token: string, partial: Partial<Element> & Pick<Element, "role" | "name">): Element => ({
  token,
  stableId: `${partial.role}|${partial.name}`,
  roleClass: partial.role === "button" ? "button" : partial.role === "textbox" ? "textbox" : "heading",
  nativeRole: partial.role,
  states: [],
  actions: [],
  bounds: null,
  visibleBounds: null,
  boundsTrust: "none",
  region: "main",
  frame: "main",
  risk: "safe",
  ...partial,
});

const result = (effect: ActionResult["effect"], extra: Partial<ActionResult> = {}): ActionResult => ({
  effect,
  route: "semantic",
  evidence: [],
  invalidatedSnapshots: [],
  durationMs: 1,
  ...extra,
});

export interface FakeLoginOptions {
  email: string;
  passwordSecret: string;
  secrets: SecretsRegistry;
  /** Renames the submit button (simulates a UI change for replay healing tests). */
  submitLabel?: string;
}

export class FakeLoginComputer implements Computer {
  url = "about:blank";
  email = "";
  password = "";
  loggedIn = false;
  snapshots = 0;
  readonly actions: string[] = [];
  readonly #opts: FakeLoginOptions;

  constructor(opts: FakeLoginOptions) {
    this.#opts = opts;
  }

  capabilities() {
    return {
      surface: "web" as const,
      semanticActions: true,
      pointer: false,
      screenshots: true,
      recording: false,
      secretMasking: true,
    };
  }
  async doctor() {
    return [{ name: "fake", ok: true, detail: "in-memory" }];
  }
  async open(target: string): Promise<Result<void, ComputerError>> {
    this.url = target;
    return ok(undefined);
  }
  async observe(): Promise<Result<Snapshot, ComputerError>> {
    this.snapshots++;
    const elements: Element[] = this.loggedIn
      ? [
          el("e1", { role: "heading", name: "Welcome, Alice" }),
          el("e2", { role: "button", name: "Sign out", actions: ["press"] }),
        ]
      : [
          el("e2", { role: "heading", name: "Sign in" }),
          el("e3", {
            role: "textbox",
            name: "Email",
            value: this.email ? "<filled>" : "<empty>",
            actions: ["set_value", "focus"],
          }),
          el("e4", {
            role: "textbox",
            name: "Password",
            value: this.password ? `[input:${this.#opts.passwordSecret}]` : "<empty>",
            actions: ["set_value", "focus"],
          }),
          el("e5", {
            role: "button",
            name: this.#opts.submitLabel ?? "Sign in",
            actions: ["press"],
            risk: "submits",
          }),
        ];
    return ok({
      id: `s${this.snapshots}`,
      surface: "web",
      takenAt: this.snapshots,
      url: this.url,
      title: this.loggedIn ? "Home" : "Sign in",
      viewport: { x: 0, y: 0, width: 1280, height: 860 },
      elements,
      text: this.loggedIn ? "Welcome, Alice" : "Sign in to continue",
      tokenEstimate: 300,
      quality: { elementCount: elements.length, unnamedInteractive: 0, score: 1 },
      narrowed: false,
    });
  }
  async screenshot() {
    return ok({
      capture: { id: "c", takenAt: 0, mimeType: "image/png" as const, width: 1, height: 1, scale: 1 },
      data: new Uint8Array([137, 80, 78, 71]),
    });
  }
  async press(token: string): Promise<ActionResult> {
    this.actions.push(`press ${token}`);
    if (token === "e5" && !this.loggedIn) {
      const expected = this.#opts.secrets.resolve(this.#opts.passwordSecret);
      if (this.email === this.#opts.email && this.password === expected) {
        this.loggedIn = true;
        this.url = this.url.replace(/\/login$/, "/home");
        return result("confirmed", { route: "semantic", evidence: [{ kind: "url", after: this.url }] });
      }
      return result("suspected_noop");
    }
    return result("unverifiable");
  }
  async setValue(token: string, value: FieldValue): Promise<ActionResult> {
    const text = typeof value === "string" ? value : this.#opts.secrets.resolve(value.secretRef);
    if (text === undefined)
      return result("refused", { error: { kind: "secret_missing", message: "unknown secret" } });
    this.actions.push(`set_value ${token}`);
    if (token === "e3") this.email = text;
    else if (token === "e4") this.password = text;
    else return result("refused", { error: { kind: "stale_token", message: token } });
    return result("confirmed", { evidence: [{ kind: "value", before: "<empty>", after: "<filled>" }] });
  }
  async toggle(): Promise<ActionResult> {
    return result("refused");
  }
  async selectOption(): Promise<ActionResult> {
    return result("refused");
  }
  async focus(): Promise<ActionResult> {
    return result("confirmed");
  }
  async selectText(): Promise<ActionResult> {
    return result("refused");
  }
  async scrollIntoView(): Promise<ActionResult> {
    return result("confirmed");
  }
  async click(): Promise<ActionResult> {
    return result("refused");
  }
  async move(): Promise<ActionResult> {
    return result("refused");
  }
  async drag(): Promise<ActionResult> {
    return result("refused");
  }
  async scroll(): Promise<ActionResult> {
    return result("refused");
  }
  async typeText(): Promise<ActionResult> {
    return result("refused");
  }
  async key(): Promise<ActionResult> {
    return result("refused");
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
