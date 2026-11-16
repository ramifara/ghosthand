// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scanner = join(import.meta.dirname, "secrets-check.ts");
// Synthetic token assembled at runtime so this test is safe for the scanner to inspect.
const token = `ghp_${"x".repeat(40)}`;

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "ghosthand-secrets-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scan(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [scanner, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      GHOSTHAND_SECRETS_FILE: join(root, "registered.env"),
      GHOSTHAND_RUNS_DIR: join(root, "runs"),
    },
  });
}

test("scans new files and redacts matching values", () => {
  fixture((root) => {
    writeFileSync(join(root, "new.txt"), token);
    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /new.txt: looks like GitHub token/);
    assert.ok(!result.stderr.includes(token));
  });
});

test("respects ignored local files", () => {
  fixture((root) => {
    writeFileSync(join(root, ".gitignore"), "local.env\n");
    writeFileSync(join(root, "local.env"), token);
    assert.equal(scan(root).status, 0);
  });
});

test("history detects a secret removed from the working tree", () => {
  fixture((root) => {
    writeFileSync(join(root, "deleted.txt"), token);
    execFileSync("git", ["add", "deleted.txt"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Scanner test",
        "-c",
        "user.email=scanner@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Synthetic scanner fixture\n\nCo-authored-by: Rami Fara <58168157+ramifara@users.noreply.github.com>",
      ],
      { cwd: root },
    );
    unlinkSync(join(root, "deleted.txt"));
    assert.equal(scan(root).status, 0);
    const result = scan(root, ["--history"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /git blob [a-f0-9]+: looks like GitHub token/);
    assert.ok(!result.stderr.includes(token));
  });
});

test("detects UTF-8 registered secrets without printing their values", () => {
  fixture((root) => {
    const value = "synthetic-credential-\u00e9\u00e8\u00ea";
    writeFileSync(join(root, ".gitignore"), "registered.env\n");
    writeFileSync(join(root, "registered.env"), `TEST_SECRET=${value}\n`);
    writeFileSync(join(root, "leaked.txt"), value);
    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /leaked.txt: value of TEST_SECRET/);
    assert.ok(!result.stderr.includes(value));
  });
});
