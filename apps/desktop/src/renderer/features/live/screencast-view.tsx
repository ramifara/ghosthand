// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// The agent's browser as a CDP screencast, with a corner-bracket reticle on the element the last action
// targeted and its confidence. The image is display only: the agent never drives an Electron window,
// and the user takes over in the real browser window.
import type { Rect, ScreencastMetadata } from "@ghosthand/protocol";
import { cn } from "../../lib/cn.ts";
import { formatPct } from "../../lib/format.ts";
import { confidenceBand, projectRect } from "./overlay-geometry.ts";

export interface ReticleTarget {
  label: string;
  bounds: Rect;
  confidence?: number;
}

const BAND_COLOR = { high: "var(--accent)", mid: "var(--accent)", low: "var(--amber)", none: "var(--muted)" };

function Reticle({ target, meta, live }: { target: ReticleTarget; meta: ScreencastMetadata; live: boolean }) {
  const box = projectRect(target.bounds, meta);
  if (!box) return null;
  const color = BAND_COLOR[confidenceBand(target.confidence)];
  const corner = "absolute size-2.5 border-current";
  return (
    <div
      className={cn("pointer-events-none absolute", live && "reticle-live")}
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
        color,
      }}
    >
      <span className={cn(corner, "-left-1 -top-1 border-l-2 border-t-2")} />
      <span className={cn(corner, "-right-1 -top-1 border-r-2 border-t-2")} />
      <span className={cn(corner, "-left-1 -bottom-1 border-b-2 border-l-2")} />
      <span className={cn(corner, "-right-1 -bottom-1 border-b-2 border-r-2")} />
      <span
        className="absolute left-0 -top-6 flex max-w-[22rem] items-center gap-1.5 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 font-mono text-2xs text-white shadow"
        style={{ background: color }}
      >
        <span className="truncate">{target.label}</span>
        {target.confidence !== undefined ? (
          <span className="opacity-90">{formatPct(target.confidence)}</span>
        ) : null}
      </span>
    </div>
  );
}

export function ScreencastView({
  src,
  meta,
  target,
  live,
  paused,
  emptyLabel,
}: {
  src: string | undefined;
  meta: ScreencastMetadata | undefined;
  target?: ReticleTarget | undefined;
  live: boolean;
  paused?: boolean;
  emptyLabel: string;
}) {
  const aspect = meta ? `${meta.deviceWidth} / ${meta.deviceHeight}` : "1280 / 860";
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-[repeating-linear-gradient(45deg,var(--panel-2)_0_6px,var(--panel)_6px_12px)] p-3">
      <div
        className="relative max-h-full max-w-full overflow-visible rounded-[3px] border border-line-strong bg-panel shadow-sm"
        style={{ aspectRatio: aspect, width: "100%" }}
      >
        {src ? (
          <img
            src={src}
            alt="Live view of the agent's browser"
            className="block h-full w-full select-none"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">{emptyLabel}</div>
        )}
        {src && meta && target ? <Reticle target={target} meta={meta} live={live && !paused} /> : null}
        {paused ? (
          <div className="absolute inset-0 flex items-start justify-center bg-amber/10 ring-2 ring-amber ring-inset">
            <span className="mt-3 rounded-[3px] bg-amber px-2 py-1 font-mono text-2xs uppercase tracking-wider text-white">
              You have control · the agent is paused
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
