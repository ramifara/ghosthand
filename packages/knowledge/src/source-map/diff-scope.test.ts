// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { describe, expect, it } from "vitest";
import { diffHead, diffNameOnly, diffPatch } from "./__fixtures__/diff-app.ts";
import { buildSourceMap } from "./build-source-map.ts";
import { isAddedTestid, scopeDiff } from "./diff-scope.ts";
import { diffOracles } from "./source-oracles.ts";
import { parseUnifiedDiff } from "./unified-diff.ts";

const map = buildSourceMap(diffHead, { root: "/repo/web/src", generatedAt: "2026-10-01T00:00:00.000Z" });

describe("parseUnifiedDiff", () => {
  it("reads files, statuses and line numbers", () => {
    const files = parseUnifiedDiff(diffPatch);
    expect(files.map((f) => [f.newPath, f.status])).toEqual([
      ["web/src/app.tsx", "modified"],
      ["web/src/inbox.tsx", "modified"],
      ["web/src/reports.tsx", "added"],
      ["web/src/shell.tsx", "modified"],
    ]);
    const inbox = files[1];
    expect(inbox?.hunks[1]?.lines.map((l) => [l.kind, l.line])).toEqual([
      ["del", 6],
      ["del", 7],
      ["add", 7],
      ["add", 8],
    ]);
  });

  it("handles renames, deletions and plain ---/+++ diffs", () => {
    const text = `diff --git a/a.ts b/b.ts
similarity index 90%
rename from a.ts
rename to b.ts
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-x
--- old.ts
+++ new.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
`;
    const files = parseUnifiedDiff(text);
    expect(files.map((f) => [f.oldPath, f.newPath, f.status])).toEqual([
      ["a.ts", "b.ts", "renamed"],
      ["gone.ts", undefined, "deleted"],
      ["old.ts", "new.ts", "renamed"],
    ]);
    expect(files[2]?.hunks[0]?.lines).toEqual([
      { kind: "del", text: "old", line: 2 },
      { kind: "add", text: "new", line: 2 },
    ]);
  });
});

describe("scopeDiff", () => {
  const surface = scopeDiff(map, { nameOnly: diffNameOnly, patch: diffPatch, pathPrefix: "web/src/" });

  it("maps changed files to components and affected routes", () => {
    expect(surface.files).toEqual(["app.tsx", "inbox.tsx", "reports.tsx", "shell.tsx"]);
    expect(surface.outOfScope).toEqual(["packages/other/x.ts"]);
    expect(surface.components).toEqual(["App", "InboxPage", "ReportsPage", "Shell"]);
    expect(surface.routes).toEqual(["/inbox", "/reports"]);
    expect(surface.routesAdded).toEqual(["/reports"]);
    expect(surface.routesRemoved).toEqual([]);
    expect(surface.precise).toBe(true);
  });

  it("finds added, removed and renamed testids, including data-driven ones", () => {
    expect(surface.testids).toEqual({
      added: ["inbox.unread", "nav.reports", "reports.title"],
      removed: ["inbox.legacy"],
      renamed: [{ from: "inbox.list", to: "inbox.messages" }],
    });
    expect(isAddedTestid(surface, "nav.reports")).toBe(true);
    expect(isAddedTestid(surface, "nav.inbox")).toBe(false);
  });

  it("lists head elements on added lines", () => {
    const ids = surface.elements.map((e) => e.testid ?? e.text);
    expect(ids).toEqual(
      expect.arrayContaining(["Unread", "inbox.messages", "inbox.unread", "nav.reports", "reports.title"]),
    );
    expect(ids).not.toContain("nav.inbox");
  });

  it("falls back to whole files without a patch", () => {
    const loose = scopeDiff(map, { nameOnly: diffNameOnly, pathPrefix: "web/src" });
    expect(loose.precise).toBe(false);
    expect(loose.testids.added).toEqual([]);
    expect(loose.routes).toEqual(["/inbox", "/reports"]);
    expect(loose.elements.some((e) => e.testid === "nav.inbox")).toBe(true);
  });

  it("derives deterministic predicates for added testids and headings", () => {
    const oracles = diffOracles(map, surface);
    const on = (route: string) => oracles.filter((o) => o.route === route).map((o) => o.predicate);
    expect(on("/reports")).toEqual(
      expect.arrayContaining([
        { kind: "visible", name: "Reports", role: "link" },
        { kind: "visible", name: "Reports", role: "heading" },
        { kind: "text", text: "Reports" },
      ]),
    );
    expect(on("/inbox")).toEqual(
      expect.arrayContaining([
        { kind: "visible", name: "Messages", role: "list" },
        { kind: "text", text: "3 unread" },
        { kind: "text", text: "Unread" },
      ]),
    );
    expect(oracles.find((o) => o.testid === "inbox.unread")).toMatchObject({
      reason: "testid-added",
      file: "inbox.tsx",
      line: 8,
    });
  });
});
