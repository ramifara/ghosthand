// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { InputPacing } from "./input-pacing.ts";

describe("paced input", () => {
  it("types Unicode once, without edits, with bounded varied delays", async () => {
    const waits: number[] = [];
    const chars: string[] = [];
    let n = 0;
    const pacing = new InputPacing(
      "human",
      () => (n++ % 4) / 4,
      async (ms) => {
        waits.push(ms);
      },
    );
    await pacing.type("Hello 👋 café", async (char) => {
      chars.push(char);
    });
    expect(chars.join("")).toBe("Hello 👋 café");
    expect(chars).toContain("👋");
    expect(new Set(waits).size).toBeGreaterThan(1);
    expect(waits.every((ms) => ms >= 25 && ms <= 95)).toBe(true);
    waits.length = 0;
    await pacing.type("x".repeat(1000), async () => {});
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8000);
  });

  it("splits wheel input but preserves its total and finishes mouse travel at the target", async () => {
    const moves: Array<[number, number]> = [];
    const wheels: Array<[number, number]> = [];
    const page = {
      mouse: {
        move: async (x: number, y: number) => {
          moves.push([x, y]);
        },
        wheel: async (x: number, y: number) => {
          wheels.push([x, y]);
        },
      },
    } as unknown as Page;
    const pacing = new InputPacing(
      "human",
      () => 0.5,
      async () => {},
    );
    await pacing.move(page, { x: 200, y: 100 });
    expect(moves.length).toBeGreaterThan(1);
    expect(moves.at(-1)).toEqual([200, 100]);
    await pacing.scroll(page, -250, 900);
    expect(wheels.length).toBeGreaterThan(1);
    expect(wheels.reduce((n, w) => n + w[0], 0)).toBeCloseTo(-250);
    expect(wheels.reduce((n, w) => n + w[1], 0)).toBeCloseTo(900);
  });
});
