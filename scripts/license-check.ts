// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Fails when an installed dependency uses a license outside the allowlist (ADR 0001).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const allowed = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "MPL-2.0",
  "Zlib",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "WTFPL",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Artistic-2.0",
  "BSL-1.0",
]);
// Packages whose metadata lacks an SPDX id but whose license was checked by hand.
const reviewed: Record<string, string> = {};

type Finding = { name: string; version: string; license: string };

function normalize(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((x) => normalize(x)).join(" OR ");
  if (raw && typeof raw === "object" && "type" in raw) return String((raw as { type: unknown }).type);
  return "UNKNOWN";
}

function isAllowed(expr: string): boolean {
  const cleaned = expr.replace(/[()]/g, "").trim();
  if (cleaned.includes(" OR ")) return cleaned.split(" OR ").some((p) => isAllowed(p));
  if (cleaned.includes(" AND ")) return cleaned.split(" AND ").every((p) => isAllowed(p));
  return allowed.has(cleaned);
}

function* packageDirs(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name);
    if (entry.name.startsWith("@")) {
      for (const sub of readdirSync(dir, { withFileTypes: true })) yield join(dir, sub.name);
    } else {
      yield dir;
    }
    const nested = join(dir, "node_modules");
    if (existsSync(nested)) yield* packageDirs(nested);
  }
}

const bad: Finding[] = [];
let count = 0;
for (const dir of packageDirs("node_modules")) {
  const file = join(dir, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8")) as {
    name?: string;
    version?: string;
    license?: unknown;
    licenses?: unknown;
    private?: boolean;
  };
  if (!pkg.name || pkg.name.startsWith("@ghosthand/")) continue;
  count++;
  const license = reviewed[pkg.name] ?? normalize(pkg.license ?? pkg.licenses);
  if (!isAllowed(license)) bad.push({ name: pkg.name, version: pkg.version ?? "?", license });
}

if (bad.length > 0) {
  console.error(`license:check: ${bad.length} of ${count} packages use a license outside the allowlist:`);
  for (const b of bad) console.error(`  ${b.name}@${b.version}: ${b.license}`);
  process.exit(1);
}
console.log(`license:check: ${count} packages OK`);

// Every tracked source file carries an SPDX header, except files annotated in REUSE.toml.
const exempt = [
  /^LICENSE$/,
  /\.json$/,
  /^bun\.lock$/,
  /__fixtures__\//,
  /__recordings__\//,
  /^docs\/(plan|research)\//,
  /^docs\/reports\/.*\.html$/,
  /^\.changeset\/.*\.md$/,
  /\.(svg|png|ico|jpg|webp|zip)$/,
  /^CLAUDE\.md$/,
];
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const missing = tracked.filter(
  (f) =>
    !exempt.some((re) => re.test(f)) &&
    existsSync(f) &&
    !readFileSync(f, "utf8").split("\n").slice(0, 5).join("\n").includes("SPDX-License-Identifier"),
);
if (missing.length > 0) {
  console.error(`license:check: ${missing.length} file(s) without an SPDX header:`);
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`license:check: SPDX headers present in ${tracked.length} files`);
