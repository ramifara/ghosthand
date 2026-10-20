// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L4 canvas target (ADR 0020): three shapes painted on a canvas. There is no DOM node per shape, so the
// agent must locate the one it is asked for on the screenshot and click that point.
import { CANVAS_TARGET_SHAPES, type CanvasTargetShape } from "@ghosthand/testbed-kit/lab";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";

const WIDTH = 560;
const HEIGHT = 320;

interface Shape {
  name: CanvasTargetShape;
  hit: (x: number, y: number) => boolean;
  paint: (ctx: CanvasRenderingContext2D) => void;
}

const SHAPES: Shape[] = [
  {
    name: "blue square",
    hit: (x, y) => x >= 60 && x <= 180 && y >= 100 && y <= 220,
    paint: (ctx) => {
      ctx.fillStyle = "#2f6fd6";
      ctx.fillRect(60, 100, 120, 120);
    },
  },
  {
    name: "red circle",
    hit: (x, y) => (x - 300) ** 2 + (y - 160) ** 2 <= 60 ** 2,
    paint: (ctx) => {
      ctx.fillStyle = "#d63b2f";
      ctx.beginPath();
      ctx.arc(300, 160, 60, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    name: "green triangle",
    hit: (x, y) => {
      // Point-in-triangle by half-plane tests, vertices (430,220) (490,100) (550,220).
      const sign = (ax: number, ay: number, bx: number, by: number) =>
        (x - bx) * (ay - by) - (ax - bx) * (y - by);
      const d1 = sign(430, 220, 490, 100);
      const d2 = sign(490, 100, 550, 220);
      const d3 = sign(550, 220, 430, 220);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    },
    paint: (ctx) => {
      ctx.fillStyle = "#2f9e5b";
      ctx.beginPath();
      ctx.moveTo(430, 220);
      ctx.lineTo(490, 100);
      ctx.lineTo(550, 220);
      ctx.closePath();
      ctx.fill();
    },
  },
];

function draw(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#f6f4ee";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (const s of SHAPES) s.paint(ctx);
}

export function LabCanvasTargetPage() {
  return (
    <LabPage
      title="Canvas targets"
      description="Three shapes drawn on a canvas. Click one to select it."
      what="use the canvas"
    >
      {() => <TargetCanvas />}
    </LabPage>
  );
}

function TargetCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<LabStatus>(undefined);
  useEffect(() => {
    if (canvas.current) draw(canvas.current);
  }, []);
  const onClick = async (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    const shape = SHAPES.find((s) => s.hit(x, y))?.name ?? "none";
    const res = await labApi.canvasTarget(shape);
    setStatus(res.ok ? { ok: true, text: res.value.message } : { ok: false, text: res.message });
  };
  return (
    <figure className="w-fit space-y-2 rounded-lg border border-border bg-panel p-3">
      <figcaption className="text-sm font-semibold">Drawing</figcaption>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`A drawing with a ${CANVAS_TARGET_SHAPES.join(", a ")}`}
        style={{ width: WIDTH, height: HEIGHT, cursor: "pointer" }}
        onClick={(e) => void onClick(e)}
        {...tid("canvas-target.canvas")}
      />
      <LabStatusLine status={status} />
    </figure>
  );
}
