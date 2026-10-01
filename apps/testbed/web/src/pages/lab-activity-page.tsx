// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 infinite scroll: an ARIA feed that loads the next page when a sentinel below it enters the viewport
// (IntersectionObserver). aria-setsize stays -1 while more pages exist.
import { useCallback, useEffect, useRef, useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { Button } from "../components/ui/button.tsx";
import { type LabFeedEvent, labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

export function LabActivityPage() {
  return (
    <LabPage
      title="Activity"
      description="Everything that happened in your workspace, newest first. Flag events that need follow-up."
      what="see activity"
    >
      {() => <Feed />}
    </LabPage>
  );
}

function Feed() {
  const [events, setEvents] = useState<LabFeedEvent[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<LabStatus>(undefined);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (busy.current || next === null) return;
    busy.current = true;
    setLoading(true);
    const res = await labApi.activity(next);
    busy.current = false;
    setLoading(false);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setEvents((all) => [...all, ...res.value.events.filter((e) => !all.some((a) => a.id === e.id))]);
    setNext(res.value.next);
  }, [next]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  async function flag(event: LabFeedEvent) {
    const res = await labApi.flagEvent(event.id);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    setEvents((all) => all.map((e) => (e.id === event.id ? { ...e, flagged: true } : e)));
    setStatus({ ok: true, text: res.value.message });
  }

  const done = next === null;
  return (
    <div className="max-w-xl space-y-3">
      <LabStatusLine status={status} />
      <div
        role="feed"
        aria-label="Activity"
        aria-busy={loading}
        className="space-y-2"
        {...tid("activity.feed")}
      >
        {events.map((event, i) => (
          <article
            key={event.id}
            aria-labelledby={`evt-${event.id}`}
            aria-posinset={i + 1}
            aria-setsize={done ? events.length : -1}
            className="flex min-h-14 items-center gap-3 rounded-md border border-border bg-panel px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p id={`evt-${event.id}`} className="truncate text-sm">
                {event.title}
              </p>
              <p className="font-mono text-xs text-muted">{event.at.slice(0, 16).replace("T", " ")}</p>
            </div>
            {event.flagged ? (
              <span className="text-xs font-medium text-accent">Flagged</span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Flag: ${event.title}`}
                onClick={() => void flag(event)}
                {...tid(`activity.flag.${event.id}`)}
              >
                Flag
              </Button>
            )}
          </article>
        ))}
      </div>
      <div ref={sentinel} className="h-8 text-center text-xs text-muted">
        {loading ? "Loading older events…" : done ? "You've reached the beginning." : ""}
      </div>
    </div>
  );
}
