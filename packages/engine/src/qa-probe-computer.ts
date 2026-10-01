// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A pass-through Computer for QA runs. It remembers the latest snapshot and screenshot (the QA judge
// needs the page as it was when a step ended), runs an axe audit once per visited page, and ignores
// close() so the case executor can observe the final page after the loop returns.
import { auditA11y, type WebComputer } from "@ghosthand/driver-playwright";
import type {
  ActionResult,
  Computer,
  ComputerCapabilities,
  ComputerError,
  DoctorCheck,
  FieldValue,
  ObserveScope,
  PointerTarget,
  Predicate,
  PredicateResult,
  Rect,
  Result,
  Snapshot,
} from "@ghosthand/protocol";
import type { PageA11y } from "@ghosthand/qa";

export class QaProbeComputer implements Computer {
  readonly inner: WebComputer;
  latestSnapshot: Snapshot | undefined;
  latestScreenshot: Uint8Array | undefined;
  readonly a11y: PageA11y[] = [];
  readonly #audit: boolean;
  readonly #audited = new Set<string>();

  constructor(inner: WebComputer, opts: { audit: boolean }) {
    this.inner = inner;
    this.#audit = opts.audit;
  }

  /** Audits the current page once per origin+path. */
  async auditCurrentPage(): Promise<void> {
    if (!this.#audit) return;
    const url = this.inner.page.url();
    const key = pageKey(url);
    if (!key || this.#audited.has(key)) return;
    this.#audited.add(key);
    const r = await auditA11y(this.inner.page);
    this.a11y.push(
      r.ok
        ? { url: key, violations: r.value.violations }
        : { url: key, violations: [], error: r.error.message },
    );
  }

  capabilities(): ComputerCapabilities {
    return this.inner.capabilities();
  }
  doctor(): Promise<DoctorCheck[]> {
    return this.inner.doctor();
  }
  open(target: string): Promise<Result<void, ComputerError>> {
    return this.inner.open(target);
  }
  async observe(scope?: ObserveScope): Promise<Result<Snapshot, ComputerError>> {
    const r = await this.inner.observe(scope);
    if (r.ok) {
      this.latestSnapshot = r.value;
      await this.auditCurrentPage();
    }
    return r;
  }
  async screenshot(region?: Rect) {
    const r = await this.inner.screenshot(region);
    if (r.ok && region === undefined) this.latestScreenshot = r.value.data;
    return r;
  }
  press(token: string): Promise<ActionResult> {
    return this.inner.press(token);
  }
  setValue(token: string, value: FieldValue): Promise<ActionResult> {
    return this.inner.setValue(token, value);
  }
  toggle(token: string, checked?: boolean): Promise<ActionResult> {
    return this.inner.toggle(token, checked);
  }
  selectOption(token: string, option: string): Promise<ActionResult> {
    return this.inner.selectOption(token, option);
  }
  focus(token: string): Promise<ActionResult> {
    return this.inner.focus(token);
  }
  scrollIntoView(token: string): Promise<ActionResult> {
    return this.inner.scrollIntoView(token);
  }
  click(
    target: PointerTarget,
    opts?: { button?: "left" | "right" | "middle"; count?: number },
  ): Promise<ActionResult> {
    return this.inner.click(target, opts);
  }
  move(target: PointerTarget): Promise<ActionResult> {
    return this.inner.move(target);
  }
  drag(from: PointerTarget, to: PointerTarget): Promise<ActionResult> {
    return this.inner.drag(from, to);
  }
  scroll(dx: number, dy: number, target?: PointerTarget): Promise<ActionResult> {
    return this.inner.scroll(dx, dy, target);
  }
  typeText(text: FieldValue): Promise<ActionResult> {
    return this.inner.typeText(text);
  }
  key(keys: string[]): Promise<ActionResult> {
    return this.inner.key(keys);
  }
  verify(predicates: Predicate[]): Promise<PredicateResult[]> {
    return this.inner.verify(predicates);
  }
  waitIdle(opts?: { capMs?: number }): Promise<{ waitedMs: number; reason: string }> {
    return this.inner.waitIdle(opts);
  }
  startRecording(dir: string): Promise<Result<void, ComputerError>> {
    return this.inner.startRecording(dir);
  }
  stopRecording(): Promise<Result<{ files: string[] }, ComputerError>> {
    return this.inner.stopRecording();
  }
  /** No-op: the executor closes the browser after the final observation. */
  async close(): Promise<void> {}
}

function pageKey(url: string): string | undefined {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? `${u.origin}${u.pathname}` : undefined;
  } catch {
    return undefined;
  }
}
