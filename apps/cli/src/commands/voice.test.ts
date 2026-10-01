// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUtterance } from "@ghosthand/voice";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatParse, voiceCommand } from "./voice.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    out.push(String(s));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    err.push(String(s));
    return true;
  });
  return { out, err };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ghosthand voice", () => {
  it("parse prints the parsed command", async () => {
    const c = capture();
    expect(await voiceCommand(["parse", "no,", "the", "second", "invoice"], { json: false })).toBe(0);
    expect(c.out.join("")).toBe('command  correct (correction) → "invoice" #2\n');
    expect(formatParse(parseUtterance("find my latest order and cancel it"))).toBe(
      'goal     "find my latest order and cancel it" (planner)',
    );
  });

  it("parse --json prints the VoiceCommand", async () => {
    const c = capture();
    await voiceCommand(["parse", "click 12"], { json: true });
    expect(JSON.parse(c.out.join(""))).toMatchObject({
      kind: "command",
      command: { verb: "click", badge: 12 },
    });
  });

  it("models list shows the catalog without touching the network", async () => {
    const c = capture();
    const dir = mkdtempSync(join(tmpdir(), "gh-cli-models-"));
    expect(await voiceCommand(["models", "list"], { json: false, modelsDir: dir })).toBe(0);
    const text = c.out.join("");
    expect(text).toContain(`models dir: ${dir}`);
    expect(text).toMatch(/\* moonshine-tiny-en\s+moonshine/);
    expect(
      await voiceCommand(["models", "remove", "moonshine-tiny-en"], { json: false, modelsDir: dir }),
    ).toBe(0);
    expect(c.out.join("")).toContain("moonshine-tiny-en was not installed");
    expect(await voiceCommand(["models", "download", "nope"], { json: false, modelsDir: dir })).toBe(1);
    expect(c.err.join("")).toContain('unknown_model: unknown model "nope"');
  });

  it("transcribe rejects bad input before loading any backend", async () => {
    const c = capture();
    expect(await voiceCommand(["transcribe"], { json: false })).toBe(2);
    expect(await voiceCommand(["transcribe", "x.wav"], { json: false, backend: "siri" })).toBe(2);
    const notWav = join(mkdtempSync(join(tmpdir(), "gh-cli-wav-")), "a.wav");
    writeFileSync(notWav, "not audio");
    expect(await voiceCommand(["transcribe", notWav], { json: false })).toBe(1);
    expect(c.err.join("")).toContain("not a RIFF/WAVE file");
  });

  it("unknown subcommands fail with usage", async () => {
    const c = capture();
    expect(await voiceCommand(["sing"], { json: false })).toBe(2);
    expect(c.err.join("")).toContain("unknown voice subcommand");
  });
});
