// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 pointer-events kanban: cards follow pointerdown/pointermove/pointerup (no HTML5 drag and drop). On
// release, the column under the pointer receives the card at the slot nearest the pointer. Cards carry
// aria-roledescription="draggable card"; columns are named lists with aria-dropeffect="move".
import type { BoardColumn, CardRow } from "@ghosthand/testbed-kit/lab";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { cn } from "../lib/cn.ts";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

interface DragState {
  id: string;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  active: boolean;
}

export function LabBoardPage() {
  return (
    <LabPage
      title="Board"
      description="Drag cards between columns to update their status."
      what="use the board"
    >
      {() => <Board />}
    </LabPage>
  );
}

function Board() {
  const [columns, setColumns] = useState<{ id: BoardColumn; name: string }[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [drag, setDrag] = useState<DragState | undefined>(undefined);
  const [status, setStatus] = useState<LabStatus>(undefined);
  const dragRef = useRef<DragState | undefined>(undefined);

  useEffect(() => {
    void labApi.board().then((res) => {
      if (!res.ok) return setStatus({ ok: false, text: res.message });
      setColumns(res.value.columns);
      setCards(res.value.cards);
    });
  }, []);

  const update = (next: DragState | undefined) => {
    dragRef.current = next;
    setDrag(next);
  };
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // While a card is pressed, the window follows the pointer (the card itself stops receiving hits).
  const dragId = drag?.id;
  useEffect(() => {
    if (dragId === undefined) return;
    const move = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      update({ ...d, dx, dy, active: d.active || Math.hypot(dx, dy) > DRAG_THRESHOLD });
    };
    const up = (e: globalThis.PointerEvent) => void release(e);
    const cancel = () => update(undefined);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragId]);

  function onPointerDown(e: PointerEvent<HTMLLIElement>, id: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    update({ id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, active: false });
  }

  async function release(e: globalThis.PointerEvent) {
    const d = dragRef.current;
    update(undefined);
    if (!d?.active) return;
    const cards = cardsRef.current;
    // The dragged card ignores the pointer while moving, so this finds what is underneath it.
    const under = document.elementsFromPoint(e.clientX, e.clientY);
    const list = under.map((el) => el.closest<HTMLElement>("[data-column]")).find((el) => el !== null);
    const column = list?.dataset.column as BoardColumn | undefined;
    const card = cards.find((c) => c.id === d.id);
    if (!list || !column || !card) return;
    const others = Array.from(list.querySelectorAll<HTMLElement>("[data-card-id]")).filter(
      (el) => el.dataset.cardId !== d.id,
    );
    const position = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 < e.clientY;
    }).length;
    if (column === card.column && position === card.position) return;
    const res = await labApi.moveCard(d.id, column, position);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setCards(res.value.cards);
    setStatus({ ok: true, text: res.value.message });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {columns.map((col) => {
          const inColumn = cards.filter((c) => c.column === col.id).sort((a, b) => a.position - b.position);
          return (
            <section
              key={col.id}
              aria-labelledby={`col-${col.id}`}
              className="rounded-lg border border-border bg-accent-soft/40 p-2"
            >
              <h2 id={`col-${col.id}`} className="mb-2 px-1 text-sm font-semibold">
                {`${col.name} (${inColumn.length})`}
              </h2>
              <ul
                // biome-ignore lint/a11y/noRedundantRoles: list-style none drops the implicit role in some browsers.
                role="list"
                aria-label={col.name}
                aria-dropeffect="move"
                data-column={col.id}
                className="min-h-48 space-y-2"
                {...tid(`board.column.${col.id}`)}
              >
                {inColumn.map((card) => {
                  const moving = drag?.id === card.id && drag.active;
                  return (
                    <li
                      key={card.id}
                      data-card-id={card.id}
                      aria-roledescription="draggable card"
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: cards are focusable so keyboard users can find them.
                      tabIndex={0}
                      onPointerDown={(e) => onPointerDown(e, card.id)}
                      style={moving ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
                      className={cn(
                        "cursor-grab touch-none rounded-md border border-border bg-panel px-3 py-2 text-sm shadow-sm select-none",
                        moving && "pointer-events-none relative z-10 cursor-grabbing shadow-lg",
                      )}
                      {...tid(`board.card.${card.id}`)}
                    >
                      {card.title}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <LabStatusLine status={status} />
    </div>
  );
}
