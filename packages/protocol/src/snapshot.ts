// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";
import { Element } from "./element.ts";
import { Rect } from "./geometry.ts";

export const SurfaceKind = z.enum(["web", "x11", "wayland", "windows", "macos"]);
export type SurfaceKind = z.infer<typeof SurfaceKind>;

/** Code-measured quality of the element table; poor quality escalates to vision. */
export const SurfaceQuality = z.object({
  elementCount: z.number().int().nonnegative(),
  unnamedInteractive: z.number().int().nonnegative(),
  /** 0 (unusable) to 1 (every interactive element named with a role). */
  score: z.number().min(0).max(1),
});
export type SurfaceQuality = z.infer<typeof SurfaceQuality>;

/** Kind of a page region offered for narrowing (landmarks, named sections, forms, dialogs). */
export const RegionKind = z.enum([
  "dialog",
  "main",
  "section",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "other",
]);
export type RegionKind = z.infer<typeof RegionKind>;

/** One region of the page the loop can narrow to with `observe({region: id})`. */
export const RegionSummary = z.object({
  /** Stable for the same page between observations (kind + label slug), e.g. "section-lighting". */
  id: z.string().min(1),
  /** Accessible name or first heading of the region (redacted). */
  label: z.string(),
  kind: RegionKind,
  /** Visible elements inside the region. */
  elementCount: z.number().int().nonnegative(),
  /** A few element names from the region, to tell regions apart. */
  sample: z.array(z.string()).optional(),
});
export type RegionSummary = z.infer<typeof RegionSummary>;

export const Snapshot = z.object({
  id: z.string().min(1),
  surface: SurfaceKind,
  takenAt: z.number().int().nonnegative(),
  url: z.string().optional(),
  title: z.string(),
  viewport: Rect,
  elements: z.array(Element),
  /** Readable text of the page outside interactive elements (headings, messages, toasts), trimmed. */
  text: z.string(),
  /** Estimated tokens for the rendered state. */
  tokenEstimate: z.number().int().nonnegative(),
  quality: SurfaceQuality,
  /** True when the snapshot was narrowed to a region because the full page was too large. */
  narrowed: z.boolean(),
  /** Regions of the whole page (document order), for the narrowing question. */
  regions: z.array(RegionSummary).optional(),
  /** Estimated tokens of the whole page's element table before capping or scoping. */
  pageTokenEstimate: z.number().int().nonnegative().optional(),
  /** Id of the region this snapshot is scoped to (`observe({region})`). */
  scope: z.string().optional(),
  /**
   * Scrolling would reveal content that is not in the element table yet (an ARIA feed or infinite list,
   * or a virtualized list whose aria-setsize/aria-rowcount exceeds the rendered items). The loop offers
   * the `scroll` operation only then.
   */
  canScroll: z.boolean().optional(),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const Capture = z.object({
  id: z.string().min(1),
  snapshotId: z.string().optional(),
  takenAt: z.number().int().nonnegative(),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Device pixel ratio, so image pixels can be mapped back to screen points. */
  scale: z.number().positive(),
  region: Rect.optional(),
  /** File name inside the run folder, when written. */
  file: z.string().optional(),
});
export type Capture = z.infer<typeof Capture>;
