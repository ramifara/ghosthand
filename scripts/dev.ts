// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Starts the development processes (testbed now, desktop from Phase 2) with prefixed output.
import { spawn } from "node:child_process";

const processes: Array<[string, string[]]> = [["testbed", ["run", "dev:testbed"]]];

for (const [name, args] of processes) {
  const child = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((l) => `[${name}] ${l}`)
      .join("\n");
  child.stdout.on("data", (c: Buffer) => console.log(prefix(c)));
  child.stderr.on("data", (c: Buffer) => console.error(prefix(c)));
  child.on("exit", (code) => console.log(`[${name}] exited with ${code}`));
}
