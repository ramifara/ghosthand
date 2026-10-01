// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Head sources of a small app under "web/src" plus a synthetic `git diff --unified=0` against its base:
// a route and page added, a data-driven nav testid added, one testid renamed, one removed, one added.
import type { SourceFile } from "../build-source-map.ts";

export const diffHead: SourceFile[] = [
  {
    path: "app.tsx",
    content: `import { Route, Routes } from "react-router";
import { Shell } from "./shell.tsx";
import { InboxPage } from "./inbox.tsx";
import { ReportsPage } from "./reports.tsx";
export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="inbox" element={<InboxPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>
    </Routes>
  );
}
`,
  },
  { path: "tid.ts", content: `export function tid(id: string) { return { "data-testid": id }; }\n` },
  {
    path: "shell.tsx",
    content: `import { NavLink, Outlet } from "react-router";
import { tid } from "./tid.ts";
const links = [
  { to: "/inbox", label: "Inbox", id: "nav.inbox" },
  { to: "/reports", label: "Reports", id: "nav.reports" },
];
export function Shell() {
  return (
    <div>
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} {...tid(l.id)}>
          {l.label}
        </NavLink>
      ))}
      <Outlet />
    </div>
  );
}
`,
  },
  {
    path: "inbox.tsx",
    content: `import { tid } from "./tid.ts";
export function InboxPage() {
  return (
    <main>
      <h1>Inbox</h1>
      <h2>Unread</h2>
      <ul aria-label="Messages" {...tid("inbox.messages")} />
      <span {...tid("inbox.unread")}>3 unread</span>
    </main>
  );
}
`,
  },
  {
    path: "reports.tsx",
    content: `export function ReportsPage() {
  return <h1 data-testid="reports.title">Reports</h1>;
}
`,
  },
];

export const diffNameOnly = `web/src/app.tsx
web/src/inbox.tsx
web/src/reports.tsx
web/src/shell.tsx
packages/other/x.ts
`;

export const diffPatch = `diff --git a/web/src/app.tsx b/web/src/app.tsx
index 1111111..2222222 100644
--- a/web/src/app.tsx
+++ b/web/src/app.tsx
@@ -3,0 +4 @@ import { InboxPage } from "./inbox.tsx";
+import { ReportsPage } from "./reports.tsx";
@@ -8,0 +10 @@ export function App() {
+        <Route path="reports" element={<ReportsPage />} />
diff --git a/web/src/inbox.tsx b/web/src/inbox.tsx
index 3333333..4444444 100644
--- a/web/src/inbox.tsx
+++ b/web/src/inbox.tsx
@@ -5,0 +6 @@ export function InboxPage() {
+      <h2>Unread</h2>
@@ -6,2 +7,2 @@ export function InboxPage() {
-      <ul aria-label="Messages" {...tid("inbox.list")} />
-      <p {...tid("inbox.legacy")}>Old</p>
+      <ul aria-label="Messages" {...tid("inbox.messages")} />
+      <span {...tid("inbox.unread")}>3 unread</span>
diff --git a/web/src/reports.tsx b/web/src/reports.tsx
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/web/src/reports.tsx
@@ -0,0 +1,3 @@
+export function ReportsPage() {
+  return <h1 data-testid="reports.title">Reports</h1>;
+}
diff --git a/web/src/shell.tsx b/web/src/shell.tsx
index 6666666..7777777 100644
--- a/web/src/shell.tsx
+++ b/web/src/shell.tsx
@@ -4,0 +5 @@ const links = [
+  { to: "/reports", label: "Reports", id: "nav.reports" },
`;
