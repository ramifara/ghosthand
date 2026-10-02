// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppLog, LOG_FILE, PREVIOUS_LOG_FILE } from "./app-log.ts";

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("AppLog", () => {
  it("writes host chunks and timestamped main lines, and keeps the previous log on restart", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "gh-log-")), "logs");
    const first = new AppLog(dir);
    first.write("host says hi\n");
    first.line("engine host exited with code 1");
    first.close();
    await settle();
    const text = readFileSync(join(dir, LOG_FILE), "utf8");
    expect(text).toContain("host says hi\n");
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}T.* main: engine host exited with code 1\n/);

    const second = new AppLog(dir);
    second.write("second session\n");
    second.close();
    await settle();
    expect(readFileSync(join(dir, PREVIOUS_LOG_FILE), "utf8")).toBe(text);
    expect(readFileSync(join(dir, LOG_FILE), "utf8")).toBe("second session\n");
  });

  it("stops growing past its size cap and says so", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "gh-log-")), "logs");
    const log = new AppLog(dir, { maxBytes: 20 });
    log.write("0123456789");
    log.write("0123456789-over");
    log.write("dropped");
    log.close();
    await settle();
    const text = readFileSync(join(dir, LOG_FILE), "utf8");
    expect(text).toBe("01234567890123456789-over\n[log full: later output is not kept]\n");
  });

  it("survives an unwritable folder", () => {
    // A regular file where the parent folder should be: mkdir fails with ENOTDIR.
    const blocker = join(mkdtempSync(join(tmpdir(), "gh-log-")), "not-a-dir");
    writeFileSync(blocker, "");
    const log = new AppLog(join(blocker, "logs"));
    expect(() => log.line("still fine")).not.toThrow();
    expect(existsSync(log.file)).toBe(false);
  });
});
