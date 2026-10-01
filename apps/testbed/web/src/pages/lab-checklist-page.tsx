// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 HTML5 drag and drop: a reorderable checklist. Every item is draggable (draggable="true") and a drop
// target (aria-dropeffect="move"); dropping an item on another puts it at that item's place. The new
// order is saved on drop.
import type { ChecklistRow } from "@ghosthand/testbed-kit/lab";
import { GripVertical } from "lucide-react";
import { type DragEvent, useEffect, useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { cn } from "../lib/cn.ts";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

const MIME = "application/x-ghosthand-checklist";

export function LabChecklistPage() {
  return (
    <LabPage
      title="Release checklist"
      description="Drag the steps into the order the release should follow. The order saves when you drop."
      what="edit the checklist"
    >
      {() => <Checklist />}
    </LabPage>
  );
}

function Checklist() {
  const [items, setItems] = useState<ChecklistRow[]>([]);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<LabStatus>(undefined);

  useEffect(() => {
    void labApi.checklist().then((res) => {
      if (res.ok) setItems(res.value.items);
      else setStatus({ ok: false, text: res.message });
    });
  }, []);

  async function drop(e: DragEvent<HTMLLIElement>, targetId: string) {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData(MIME) || dragging;
    setDragging(undefined);
    setOver(undefined);
    if (!sourceId || sourceId === targetId) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    const reordered = ids.flatMap((id) => items.filter((i) => i.id === id));
    setItems(reordered);
    const res = await labApi.saveChecklist(ids);
    setStatus(res.ok ? { ok: true, text: res.value.message } : { ok: false, text: res.message });
    if (res.ok) setItems(res.value.items);
  }

  return (
    <div className="max-w-md space-y-3">
      <ol
        // biome-ignore lint/a11y/noRedundantRoles: list-style none drops the implicit role in some browsers.
        role="list"
        aria-label="Release checklist"
        className="space-y-1.5"
        {...tid("checklist.list")}
      >
        {items.map((item) => (
          <li
            key={item.id}
            draggable="true"
            aria-dropeffect="move"
            onDragStart={(e) => {
              e.dataTransfer.setData(MIME, item.id);
              e.dataTransfer.effectAllowed = "move";
              setDragging(item.id);
            }}
            onDragEnd={() => {
              setDragging(undefined);
              setOver(undefined);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== item.id) setOver(item.id);
            }}
            onDragLeave={() => setOver((o) => (o === item.id ? undefined : o))}
            onDrop={(e) => void drop(e, item.id)}
            className={cn(
              "flex cursor-grab items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm select-none",
              dragging === item.id && "opacity-50",
              over === item.id && dragging !== item.id && "border-accent bg-accent-soft",
            )}
            {...tid(`checklist.item.${item.id}`)}
          >
            <GripVertical aria-hidden="true" className="size-4 text-muted" />
            {item.title}
          </li>
        ))}
      </ol>
      <LabStatusLine status={status} />
    </div>
  );
}
