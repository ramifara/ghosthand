// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readZipEntries, redactZip, writeZip } from "./redact-zip.ts";

const dir = mkdtempSync(join(tmpdir(), "ghosthand-zip-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const entry = (name: string, data: string) => ({
  name: Buffer.from(name),
  data: Buffer.from(data),
  time: 0,
  date: 33,
  flags: 0,
});

describe("redactZip", () => {
  it("replaces raw, JSON-escaped and form-encoded secrets in every text entry", () => {
    const path = join(dir, "trace.zip");
    const secret = 'pa ss"word&1';
    writeFileSync(
      path,
      writeZip([
        entry("trace.trace", `{"method":"fill","params":{"value":${JSON.stringify(secret)}}}`),
        entry("resources/body.dat", `password=${encodeURIComponent(secret).replace(/%20/g, "+")}`),
        entry("resources/page.html", `<input value="${secret}">`),
        entry("resources/shot.jpeg", secret),
      ]),
    );
    const r = redactZip(path, [["PW", secret]]);
    expect(r.ok && r.value).toBe(3);
    const entries = readZipEntries(readFileSync(path));
    if (!entries.ok) throw new Error(entries.error);
    const texts = entries.value.map((e) => e.data.toString("utf8"));
    expect(texts[0]).toContain("[input:PW]");
    expect(texts[1]).toBe("password=[input:PW]");
    expect(texts[2]).toBe('<input value="[input:PW]">');
    // Images are left alone.
    expect(texts[3]).toBe(secret);
  });

  it("leaves a clean zip untouched and fails on garbage", () => {
    const path = join(dir, "clean.zip");
    const bytes = writeZip([entry("a.txt", "nothing to see")]);
    writeFileSync(path, bytes);
    expect(redactZip(path, [["PW", "hunter2-secret"]])).toEqual({ ok: true, value: 0 });
    expect(readFileSync(path).equals(bytes)).toBe(true);
    const bad = join(dir, "bad.zip");
    writeFileSync(bad, "not a zip at all, definitely not");
    expect(redactZip(bad, [["PW", "hunter2-secret"]]).ok).toBe(false);
  });
});
