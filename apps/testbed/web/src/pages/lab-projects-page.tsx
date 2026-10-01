// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 menus: a Workspace menu that opens on hover (and stays open when its trigger is clicked), and a
// custom context menu on project rows (right-click, the ContextMenu key or Shift+F10). Rows are focusable
// and carry aria-haspopup="menu".
import { type ProjectRow, WORKSPACES, type Workspace } from "@ghosthand/testbed-kit/lab";
import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { Button } from "../components/ui/button.tsx";
import { cn } from "../lib/cn.ts";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

/** How long the hover menu waits after the pointer leaves before it closes. */
const HOVER_CLOSE_MS = 300;

const MEMBERS: Record<string, number> = {
  prj_apollo: 6,
  prj_borealis: 3,
  prj_cygnus: 9,
  prj_nimbus: 4,
  prj_orion: 12,
  prj_pulsar: 2,
  prj_quasar: 5,
};

export function LabProjectsPage() {
  return (
    <LabPage title="Projects" description="Projects in your current workspace." what="see projects">
      {() => <Projects />}
    </LabPage>
  );
}

const itemClass =
  "block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none";

function Projects() {
  const [workspace, setWorkspace] = useState<Workspace | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [status, setStatus] = useState<LabStatus>(undefined);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    void labApi.projects().then((res) => {
      if (!res.ok) return setStatus({ ok: false, text: res.message });
      setWorkspace(res.value.workspace);
      setProjects(res.value.projects);
    });
  }, []);

  async function switchTo(next: Workspace) {
    const res = await labApi.switchWorkspace(next);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setWorkspace(res.value.workspace);
    setProjects(res.value.projects);
    setStatus({ ok: true, text: res.value.message });
  }

  function openMenu(id: string, x: number, y: number) {
    setMenu({ id, x, y });
  }

  function onContextMenu(e: MouseEvent<HTMLTableRowElement>, id: string) {
    e.preventDefault();
    openMenu(id, e.clientX, e.clientY);
  }

  function onRowKey(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(id, r.left + 24, r.bottom - 4);
    }
  }

  function closeMenu(returnFocus: boolean) {
    const id = menu?.id;
    setMenu(undefined);
    if (returnFocus && id) rows.current.get(id)?.focus();
  }

  async function archive(project: ProjectRow) {
    closeMenu(false);
    const res = await labApi.archiveProject(project.id, "context_menu");
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setProjects(res.value.projects);
    setStatus({ ok: true, text: res.value.message });
  }

  const menuProject = projects.find((p) => p.id === menu?.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <WorkspaceMenu current={workspace} onPick={(w) => void switchTo(w)} />
      </div>
      <LabStatusLine status={status} />
      <table aria-label="Projects" className="w-full max-w-2xl text-left text-sm" {...tid("projects.table")}>
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="py-1.5 pl-2">Project</th>
            <th>Workspace</th>
            <th>Members</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              ref={(el) => {
                if (el) rows.current.set(p.id, el);
                else rows.current.delete(p.id);
              }}
              tabIndex={0}
              aria-haspopup="menu"
              aria-expanded={menu?.id === p.id}
              onContextMenu={(e) => onContextMenu(e, p.id)}
              onKeyDown={(e) => onRowKey(e, p.id)}
              className={cn(
                "border-b border-border/60 focus-visible:outline-2 focus-visible:outline-accent",
                menu?.id === p.id && "bg-accent-soft",
              )}
              {...tid(`projects.row.${p.id}`)}
            >
              <td className="py-2 pl-2 font-medium">{p.name}</td>
              <td>{p.workspace}</td>
              <td>{MEMBERS[p.id] ?? 1}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">Right-click a project (or press Shift+F10) for more actions.</p>
      {menu && menuProject ? (
        <ContextMenu
          key={`${menu.id}@${menu.x},${menu.y}`}
          project={menuProject}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          onArchive={() => void archive(menuProject)}
          onUnavailable={(what) => {
            closeMenu(true);
            setStatus({ ok: false, text: `${what} is not available in the lab.` });
          }}
        />
      ) : null}
    </div>
  );
}

function WorkspaceMenu({
  current,
  onPick,
}: {
  current: Workspace | undefined;
  onPick: (w: Workspace) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const wrapper = useRef<HTMLDivElement>(null);

  const cancelClose = () => window.clearTimeout(timer.current);
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    timer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => () => cancelClose(), []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only opens the menu; the button is the keyboard path.
    <div ref={wrapper} className="relative" onMouseEnter={show} onMouseLeave={scheduleClose}>
      <Button
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="workspace-menu"
        // Clicking keeps the menu open (it is already open from the hover); it never toggles it closed.
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        {...tid("projects.workspace")}
      >
        {`Workspace: ${current ?? "…"}`}
        <ChevronDown aria-hidden="true" className="size-4" />
      </Button>
      {open ? (
        <div
          id="workspace-menu"
          role="menu"
          aria-label="Workspace"
          className="absolute top-full left-0 z-20 w-44 rounded-md border border-border bg-panel p-1 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          {WORKSPACES.map((w) => (
            <button
              key={w}
              type="button"
              role="menuitemradio"
              aria-checked={w === current}
              className={itemClass}
              onClick={() => {
                setOpen(false);
                if (w !== current) onPick(w);
              }}
              {...tid(`projects.workspace.${w}`)}
            >
              {w}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContextMenu({
  project,
  x,
  y,
  onClose,
  onArchive,
  onUnavailable,
}: {
  project: ProjectRow;
  x: number;
  y: number;
  onClose: (returnFocus: boolean) => void;
  onArchive: () => void;
  onUnavailable: (what: string) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) close.current(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      onClose(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={`Actions for ${project.name}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed z-30 w-48 rounded-md border border-border bg-panel p-1 shadow-lg"
      style={{ left: x, top: y }}
      {...tid("projects.context-menu")}
    >
      <button type="button" role="menuitem" className={itemClass} onClick={() => onUnavailable("Renaming")}>
        Rename…
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => onUnavailable("Duplicating")}
      >
        Duplicate
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={onArchive}>
        Archive project
      </button>
    </div>
  );
}
