// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { BrowserBehavior } from "@ghosthand/protocol";
import type { Locator, Page } from "playwright-core";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Point = { x: number; y: number };

/** Only adds input events and timing; never repeats an action or changes its requested value. */
export class InputPacing {
  readonly human: boolean;
  readonly #random: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #positions = new WeakMap<Page, Point>();

  constructor(mode: BrowserBehavior["inputPacing"] = "instant", random = Math.random, wait = sleep) {
    this.human = mode === "human";
    this.#random = random;
    this.#sleep = wait;
  }

  #between(min: number, max: number): number {
    return min + this.#random() * (max - min);
  }

  async pause(): Promise<void> {
    if (this.human) await this.#sleep(this.#between(80, 240));
  }

  get clickDelay(): number {
    return this.human ? this.#between(45, 110) : 0;
  }

  /** Keep sensitive text in one Playwright call so traces can redact its full value. */
  typingDelay(text: string): number {
    return this.human ? Math.min(8000 / Math.max(1, Array.from(text).length), this.#between(25, 95)) : 0;
  }

  async move(page: Page, to: Point): Promise<void> {
    if (!this.human) {
      await page.mouse.move(to.x, to.y);
    } else {
      const from = this.#positions.get(page) ?? { x: 0, y: 0 };
      const steps = Math.round(this.#between(8, 16));
      const bend = this.#between(-20, 20);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const curve = Math.sin(Math.PI * t) * bend;
        await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t + curve);
        await this.#sleep(this.#between(8, 18));
      }
    }
    this.#positions.set(page, to);
  }

  async approach(page: Page, locator: Locator, timeout: number): Promise<void> {
    if (!this.human) return;
    await locator.scrollIntoViewIfNeeded({ timeout });
    const box = await locator.boundingBox({ timeout });
    if (box) await this.move(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  async type(text: string, insert: (char: string) => Promise<void>): Promise<void> {
    // A large pasted paragraph must not add minutes to a run. Unicode code points stay intact.
    const chars = Array.from(text);
    const capPerChar = 8000 / Math.max(1, chars.length);
    for (const char of chars) {
      await insert(char);
      if (this.human) await this.#sleep(Math.min(capPerChar, this.#between(25, 95)));
    }
  }

  async scroll(page: Page, dx: number, dy: number): Promise<void> {
    const parts = this.human ? Math.min(12, Math.max(1, Math.ceil(Math.hypot(dx, dy) / 120))) : 1;
    let remainingX = dx;
    let remainingY = dy;
    for (let i = 0; i < parts; i++) {
      const weight = i === parts - 1 ? 1 : this.#between(0.7, 1.3) / (parts - i);
      const x = remainingX * weight;
      const y = remainingY * weight;
      await page.mouse.wheel(x, y);
      remainingX -= x;
      remainingY -= y;
      if (this.human && i < parts - 1) await this.#sleep(this.#between(25, 65));
    }
  }
}
