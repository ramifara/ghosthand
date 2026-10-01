// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 canvas: a bar chart whose values exist only as pixels. The canvas has a name but no text
// alternative with the numbers, so reading a value needs vision.
import { useEffect, useRef, useState } from "react";
import { LabPage } from "../components/lab-page.tsx";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

const WIDTH = 560;
const HEIGHT = 300;

function draw(canvas: HTMLCanvasElement, days: string[], counts: number[]): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--ink").trim() || "#1d1f22";
  const accent = css.getPropertyValue("--accent").trim() || "#0f6b5c";
  const line = css.getPropertyValue("--line").trim() || "#c9c5ba";
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const left = 40;
  const bottom = HEIGHT - 36;
  const top = 24;
  const max = 100;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = ink;
  ctx.textAlign = "right";
  for (let v = 0; v <= max; v += 25) {
    const y = bottom - ((bottom - top) * v) / max;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(WIDTH - 10, y);
    ctx.stroke();
    ctx.fillText(String(v), left - 6, y + 4);
  }
  const slot = (WIDTH - left - 10) / days.length;
  ctx.textAlign = "center";
  days.forEach((day, i) => {
    const value = counts[i] ?? 0;
    const x = left + i * slot + slot * 0.2;
    const w = slot * 0.6;
    const h = ((bottom - top) * value) / max;
    ctx.fillStyle = accent;
    ctx.fillRect(x, bottom - h, w, h);
    ctx.fillStyle = ink;
    ctx.font = "bold 13px Inter, system-ui, sans-serif";
    ctx.fillText(String(value), x + w / 2, bottom - h - 6);
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText(day, x + w / 2, bottom + 18);
  });
}

export function LabSignupsPage() {
  return (
    <LabPage title="Sign-ups" description="New accounts created each day this week." what="see sign-ups">
      {() => <SignupsChart />}
    </LabPage>
  );
}

function SignupsChart() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    void labApi.signups().then((res) => {
      if (!res.ok) return setError(res.message);
      if (canvas.current) draw(canvas.current, res.value.days, res.value.counts);
    });
  }, []);
  return (
    <figure className="w-fit space-y-2 rounded-lg border border-border bg-panel p-3">
      <figcaption className="text-sm font-semibold">Sign-ups this week</figcaption>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Bar chart of sign-ups per day, Monday to Sunday"
        style={{ width: WIDTH, height: HEIGHT }}
        {...tid("signups.chart")}
      />
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </figure>
  );
}
