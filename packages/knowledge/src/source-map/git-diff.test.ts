// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffHead, diffNameOnly, diffPatch } from "./__fixtures__/diff-app.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { type ExecFileFn, gitChangedSurface, readGitDiff } from "./git-diff.ts";

const map = buildSourceMap(diffHead, { root: "/repo/web/src", generatedAt: "2026-10-01T00:00:00.000Z" });

function fakeGit(calls: string[][]): ExecFileFn {
  return async (file, args) => {
    expect(file).toBe("git");
    calls.push(args);
    if (args[0] === "rev-parse") return "web/src/\n";
    return args.includes("--name-only") ? diffNameOnly : diffPatch;
  };
}

describe("git diff helper", () => {
  it("runs rev-parse and two diffs over base...head and scopes the result", async () => {
    const calls: string[][] = [];
    const res = await gitChangedSurface(map, { cwd: "/repo/web/src", base: "main", exec: fakeGit(calls) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.routesAdded).toEqual(["/reports"]);
    expect(res.value.testids.renamed).toEqual([{ from: "inbox.list", to: "inbox.messages" }]);
    expect(calls[0]).toEqual(["rev-parse", "--show-prefix"]);
    expect(calls[1]).toContain("main...HEAD");
    expect(calls[2]).toContain("--unified=0");
  });

  it("rejects refs that could be read as options", async () => {
    const res = await readGitDiff({ cwd: "/x", base: "--output=/tmp/x", exec: fakeGit([]) });
    expect(res).toEqual({ ok: false, error: { kind: "invalid-ref", ref: "--output=/tmp/x" } });
  });

  it("returns git-failed outside a repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gh-sourcemap-"));
    try {
      const res = await readGitDiff({ cwd: dir, base: "main" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe("git-failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
