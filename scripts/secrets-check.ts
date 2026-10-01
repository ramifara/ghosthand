// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Greps the repo, run folders and logs for registered secret values and well-known key formats.
// Registered values come from ~/.config/ghosthand/env (local), GHOSTHAND_SECRETS_FILE (KEY=VALUE lines)
// and the testbed's fixture credentials, which must never appear in run artifacts.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const patterns: Array<[string, RegExp]> = [
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{32,}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["AWS key", /AKIA[0-9A-Z]{16}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1] && m[2]) out.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  return out;
}

const registered = new Map<string, string>();
const sources = [join(homedir(), ".config/ghosthand/env"), process.env.GHOSTHAND_SECRETS_FILE ?? ""];
for (const src of sources) {
  if (src && existsSync(src))
    for (const [k, v] of parseEnv(readFileSync(src, "utf8"))) if (v.length >= 6) registered.set(k, v);
}
const fixtureSecrets = "packages/testbed-kit/src/fixture-secrets.ts";
const fixtureValues = new Map<string, string>();
if (existsSync(fixtureSecrets)) {
  for (const m of readFileSync(fixtureSecrets, "utf8").matchAll(/(\w+):\s*"([^"]{6,})"/g)) {
    if (m[1] && m[2]) fixtureValues.set(m[1], m[2]);
  }
}

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const findings: string[] = [];
function scan(file: string, values: Map<string, string>, usePatterns: boolean): void {
  let buf: Buffer;
  try {
    if (statSync(file).size > 50 * 1024 * 1024) return;
    buf = readFileSync(file);
  } catch {
    return;
  }
  const text = buf.toString("latin1");
  for (const [name, value] of values) if (text.includes(value)) findings.push(`${file}: value of ${name}`);
  if (usePatterns)
    for (const [name, re] of patterns) if (re.test(text)) findings.push(`${file}: looks like ${name}`);
}

// 1. Tracked repo files: real secrets and key formats. Fixture values are allowed in source.
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const f of tracked) if (existsSync(f)) scan(f, registered, true);

// 2. Run folders and logs: nothing registered may appear, fixture values included.
const runRoots = [process.env.GHOSTHAND_RUNS_DIR ?? "runs", join(homedir(), ".local/share/ghosthand/runs")];
const all = new Map([...registered, ...fixtureValues]);
for (const root of runRoots) for (const f of walk(root)) scan(f, all, true);

if (findings.length > 0) {
  console.error(`secrets:check: ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `secrets:check: clean (${tracked.length} tracked files, ${registered.size + fixtureValues.size} registered values)`,
);
