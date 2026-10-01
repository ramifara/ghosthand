// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Parsers for `git diff --name-only` and unified diff text.

/** `line` is the new-file line for "add" and the old-file line for "del". */
export type DiffLine = { kind: "add" | "del"; text: string; line: number };
export type DiffHunk = { oldStart: number; newStart: number; lines: DiffLine[] };
export type FileDiff = {
  /** Path before the change; absent for added files. */
  oldPath?: string;
  /** Path after the change; absent for deleted files. */
  newPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  hunks: DiffHunk[];
};

export function parseNameOnly(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    ),
  ];
}

const stripPrefix = (p: string): string | undefined => {
  const path = p.trim().replace(/^"|"$/g, "").split("\t")[0] ?? "";
  if (path === "/dev/null") return undefined;
  return path.replace(/^[ab]\//, "");
};

export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: DiffHunk | undefined;
  let oldLeft = 0;
  let newLeft = 0;
  let oldLine = 0;
  let newLine = 0;
  const start = (): FileDiff => {
    const f: FileDiff = { status: "modified", hunks: [] };
    files.push(f);
    hunk = undefined;
    oldLeft = 0;
    newLeft = 0;
    return f;
  };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const tag = line[0];
      if (tag === "+") {
        hunk.lines.push({ kind: "add", text: line.slice(1), line: newLine++ });
        newLeft--;
        continue;
      }
      if (tag === "-") {
        hunk.lines.push({ kind: "del", text: line.slice(1), line: oldLine++ });
        oldLeft--;
        continue;
      }
      if (tag === " " || line === "") {
        oldLine++;
        newLine++;
        oldLeft--;
        newLeft--;
        continue;
      }
      if (tag === "\\") continue;
      hunk = undefined;
    }
    if (line.startsWith("diff --git ")) {
      file = start();
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m?.[1] && m[2]) {
        file.oldPath = m[1];
        file.newPath = m[2];
      }
      continue;
    }
    if (line.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) {
      if (!file || file.hunks.length > 0) file = start();
      const oldPath = stripPrefix(line.slice(4));
      const newPath = stripPrefix((lines[i + 1] ?? "").slice(4));
      if (oldPath) file.oldPath = oldPath;
      else delete file.oldPath;
      if (newPath) file.newPath = newPath;
      else delete file.newPath;
      if (!oldPath) file.status = "added";
      else if (!newPath) file.status = "deleted";
      else if (oldPath !== newPath && file.status === "modified") file.status = "renamed";
      i++;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("new file mode")) {
      file.status = "added";
      delete file.oldPath;
    } else if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      delete file.newPath;
    } else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      file.status = "renamed";
      file.newPath = line.slice("rename to ".length);
    } else {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[3]);
        oldLeft = m[2] === undefined ? 1 : Number(m[2]);
        newLeft = m[4] === undefined ? 1 : Number(m[4]);
        hunk = { oldStart: oldLine, newStart: newLine, lines: [] };
        file.hunks.push(hunk);
      }
    }
  }
  return files;
}
