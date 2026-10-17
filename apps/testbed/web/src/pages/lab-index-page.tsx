// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 lab: index of the "hard DOM" pages (not linked from the main navigation).
import { Link } from "react-router";

const PAGES = [
  { to: "/lab/checkout", label: "Checkout", note: "cross-origin and same-origin iframes" },
  { to: "/lab/preferences", label: "Notification preferences", note: "open shadow root" },
  { to: "/lab/promo", label: "Promo", note: "closed shadow root" },
  { to: "/lab/signups", label: "Sign-ups", note: "canvas chart" },
  { to: "/lab/canvas-target", label: "Canvas targets", note: "clickable shapes that exist only as paint" },
  { to: "/lab/toolbar", label: "Toolbar", note: "icon-only buttons (nameless under a11y=poor)" },
  { to: "/lab/checklist", label: "Release checklist", note: "HTML5 drag and drop" },
  { to: "/lab/board", label: "Board", note: "pointer-events kanban" },
  { to: "/lab/contacts", label: "Contacts", note: "file upload and CSV download" },
  { to: "/lab/activity", label: "Activity", note: "infinite scroll" },
  { to: "/lab/inventory", label: "Inventory", note: "virtualized list" },
  { to: "/lab/projects", label: "Projects", note: "hover menu and context menu" },
];

export function LabIndexPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Lab</h1>
      <ul className="space-y-1 text-sm">
        {PAGES.map((p) => (
          <li key={p.to}>
            <Link to={p.to} className="text-accent underline">
              {p.label}
            </Link>{" "}
            <span className="text-muted">({p.note})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
