// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// One observation: AI aria snapshot (all frames) → flat nodes → one engine call per frame for DOM facts →
// elements with redacted values. Ranking, capping and snapshot ids are the caller's business.
import { pageTextExcerpt } from "@ghosthand/core";
import type { ComputerError, Element, Rect, Region, RegionSummary, Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { Frame, Page } from "playwright-core";
import { AriaSnapshotSchema, flattenAriaSnapshot } from "./aria-tree.ts";
import type { FrameGeometry } from "./build-elements.ts";
import { buildElements } from "./build-elements.ts";
import { runEngine } from "./engine-client.ts";
import type { DomInfo, PageInfo, SectionInfo } from "./in-page/page-types.ts";
import { EnrichResult, MarksResult } from "./in-page/page-types.ts";
import type { SecretScope } from "./secret-scope.ts";
import { isSecretField } from "./secret-scope.ts";

export const MAX_TEXT_CHARS = 8000;

export interface CaptureTimings {
  ariaMs: number;
  enrichMs: number;
  buildMs: number;
}

export interface Captured {
  url: string;
  title: string;
  viewport: Rect;
  page: PageInfo | undefined;
  /** Every visible element, document order, before capping. */
  elements: Element[];
  /** Readable page text, redacted. */
  text: string;
  /** Element token → aria ref. */
  refs: Map<string, string>;
  /** Ref → ancestor refs (for token-scoped observation). */
  ancestors: Map<string, string[]>;
  /** Tokens of password-like fields (their values are never shown). */
  secretTokens: Set<string>;
  /** Element token → region id (see `regions`). */
  sections: Map<string, string>;
  /** Page regions with their element counts, in document order. */
  regions: RegionSummary[];
  /** Text of the region asked for with `sectionText`, redacted. */
  sectionText?: string;
  timings: CaptureTimings;
  /** True when the in-page engine was unavailable and elements carry aria facts only. */
  degraded: boolean;
  /** Scrolling would reveal content not in the DOM yet (feed, virtualized list); see `PageInfo.moreContent`. */
  canScroll: boolean;
}

export interface CaptureInput {
  page: Page;
  scope: SecretScope;
  snapshotId: string;
  timeoutMs: number;
  /** Region id whose readable text should be returned (scoped observation). */
  sectionText?: string;
  /** Goal words: a long page keeps its start, the lines naming them, and its end (pageTextExcerpt). */
  focus?: readonly string[];
  now?: () => number;
}

const SAMPLE_PER_REGION = 4;

const originOf = (url: string): string | undefined => {
  try {
    const o = new URL(url).origin;
    return o === "null" ? undefined : o;
  } catch {
    return undefined;
  }
};

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x);
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y);
  return { x, y, width, height };
}

async function frameForIframe(page: Page, ref: string, timeoutMs: number): Promise<Frame | undefined> {
  try {
    const handle = await page.locator(`aria-ref=${ref}`).elementHandle({ timeout: timeoutMs });
    if (!handle) return undefined;
    const frame = await handle.contentFrame();
    void handle.dispose().catch(() => {});
    return frame ?? undefined;
  } catch {
    return undefined;
  }
}

export async function captureSnapshot(input: CaptureInput): Promise<Result<Captured, ComputerError>> {
  const now = input.now ?? Date.now;
  const { page } = input;
  const t0 = now();
  let raw: unknown;
  try {
    raw = await page.ariaSnapshotJSON({ mode: "ai", boxes: true, timeout: input.timeoutMs });
  } catch (e) {
    const message = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
    return err({ kind: page.isClosed() ? "closed" : "driver", message: `aria snapshot failed: ${message}` });
  }
  const parsed = AriaSnapshotSchema.safeParse(raw);
  if (!parsed.success) return err({ kind: "driver", message: "unexpected aria snapshot shape" });
  let tree = flattenAriaSnapshot(parsed.data);
  const t1 = now();

  const frames = new Map<string, Frame>([["", page.mainFrame()]]);
  await Promise.all(
    tree.iframes.map(async (f) => {
      const frame = await frameForIframe(page, f.ref, input.timeoutMs);
      if (frame) frames.set(f.ref, frame);
    }),
  );

  // Drag sources, drop zones and rows with a context menu have no interactive role; the engine finds
  // them from their markup and they join the table.
  const extra = new Map<string, "item" | "zone">();
  await Promise.all(
    [...frames.values()].map(async (frame) => {
      const r = await runEngine(frame, { op: "marks" }, MarksResult, input.timeoutMs);
      if (!r.ok) return;
      for (const m of r.value.marks) extra.set(m.ref, m.drag || m.menu ? "item" : "zone");
    }),
  );
  if (extra.size > 0) tree = flattenAriaSnapshot(parsed.data, extra);

  // Refs to enrich, per frame key (iframe elements are enriched in the frame that contains them).
  const byFrame = new Map<string, string[]>();
  const add = (key: string, ref: string) => {
    const list = byFrame.get(key);
    if (list) list.push(ref);
    else byFrame.set(key, [ref]);
  };
  for (const n of tree.nodes) add(n.frameKey, n.ref);
  for (const f of tree.iframes) add(f.frameKey, f.ref);

  const dom = new Map<string, DomInfo | null>();
  const pageInfo = new Map<string, PageInfo>();
  let sectionInfo: SectionInfo[] = [];
  let sectionText: string | undefined;
  let degraded = false;
  await Promise.all(
    [...byFrame].map(async ([key, refs]) => {
      const frame = frames.get(key);
      if (!frame) return;
      const command =
        key === "" && input.sectionText !== undefined
          ? { op: "enrich" as const, refs, sectionText: input.sectionText }
          : { op: "enrich" as const, refs };
      const r = await runEngine(frame, command, EnrichResult, input.timeoutMs);
      if (!r.ok) {
        degraded = true;
        return;
      }
      pageInfo.set(key, r.value.page);
      // Regions come from the top document; framed content belongs to its iframe's region.
      if (key === "") {
        sectionInfo = r.value.sections;
        sectionText = r.value.sectionText;
      }
      refs.forEach((ref, i) => {
        dom.set(ref, r.value.items[i] ?? null);
      });
    }),
  );
  const t2 = now();
  // Values typed into password-like fields are redacted wherever the page echoes them, registered or not.
  const scope = input.scope.withTransient(
    [...dom.values()].flatMap((d) => (d && d.value !== undefined && isSecretField(d) ? [d.value] : [])),
  );

  // Frame geometry, parents before children (iframes are listed in document order).
  const main = pageInfo.get("");
  const viewport: Rect = { x: 0, y: 0, width: main?.innerWidth ?? 0, height: main?.innerHeight ?? 0 };
  const url = page.url();
  const geometry = new Map<string, FrameGeometry>([
    [
      "",
      {
        path: "main",
        offset: { x: 0, y: 0 },
        clip: viewport,
        region: undefined,
        hidden: false,
        origin: originOf(url),
      },
    ],
  ]);
  let pending = tree.iframes;
  for (let guard = 0; pending.length > 0 && guard < 16; guard++) {
    const next: typeof pending = [];
    for (const f of pending) {
      const parent = geometry.get(f.frameKey);
      if (!parent) {
        next.push(f);
        continue;
      }
      const info = dom.get(f.ref) ?? null;
      const offset = info?.frameOffset ?? { x: info?.rect.x ?? 0, y: info?.rect.y ?? 0 };
      const absOffset = { x: parent.offset.x + offset.x, y: parent.offset.y + offset.y };
      const rect = info
        ? {
            x: parent.offset.x + info.rect.x,
            y: parent.offset.y + info.rect.y,
            width: info.rect.width,
            height: info.rect.height,
          }
        : { x: absOffset.x, y: absOffset.y, width: 0, height: 0 };
      const region: Region | undefined =
        parent.region === "dialog"
          ? "dialog"
          : info?.region !== undefined && info.region !== "other"
            ? info.region
            : parent.region;
      const label = scope.redact(info?.frameLabel ?? `iframe ${f.ref}`);
      const childUrl = pageInfo.get(f.ref)?.url;
      geometry.set(f.ref, {
        path: `${parent.path} > ${label}`,
        offset: absOffset,
        clip: intersect(parent.clip, rect),
        region,
        hidden: parent.hidden || (info?.hidden ?? false),
        origin: childUrl !== undefined ? originOf(childUrl) : undefined,
      });
    }
    if (next.length === pending.length) break;
    pending = next;
  }

  const elements = buildElements({
    nodes: tree.nodes,
    dom,
    frames: geometry,
    snapshotId: input.snapshotId,
    scope,
  });
  const refs = new Map<string, string>();
  const ancestors = new Map<string, string[]>();
  const secretTokens = new Set<string>();
  const sections = new Map<string, string>();
  const byRef = new Map(tree.nodes.map((n) => [n.ref, n]));
  const iframeParent = new Map(tree.iframes.map((f) => [f.ref, f.frameKey]));
  const sectionOfRef = (ref: string, frameKey: string): string => {
    let key = frameKey;
    let own = ref;
    for (let guard = 0; key !== "" && guard < 16; guard++) {
      own = key;
      key = iframeParent.get(key) ?? "";
    }
    return dom.get(own)?.section ?? "page";
  };
  for (const el of elements) {
    const ref = el.token.slice(0, el.token.length - input.snapshotId.length);
    refs.set(el.token, ref);
    const node = byRef.get(ref);
    ancestors.set(ref, node?.ancestors ?? []);
    const info = dom.get(ref);
    if (info && isSecretField(info)) secretTokens.add(el.token);
    sections.set(el.token, sectionOfRef(ref, node?.frameKey ?? ""));
  }
  const regions = summarizeRegions(elements, sections, sectionInfo, scope);
  let title = "";
  try {
    title = scope.redact(await page.title());
  } catch {
    // Title is best effort while navigating.
  }
  const t3 = now();
  return ok({
    url: scope.redact(url),
    title,
    viewport,
    page: main,
    elements,
    text: pageTextExcerpt(scope.redact(tree.text), MAX_TEXT_CHARS, input.focus ?? [], { tail: true }),
    refs,
    ancestors,
    secretTokens,
    sections,
    regions,
    ...(sectionText !== undefined ? { sectionText: scope.redact(sectionText) } : {}),
    timings: { ariaMs: t1 - t0, enrichMs: t2 - t1, buildMs: t3 - t2 },
    degraded,
    canScroll: [...pageInfo.values()].some((p) => p.moreContent === true),
  });
}

/** Counts elements per region (document order of first element) and samples a few interactive names. */
function summarizeRegions(
  elements: Element[],
  sections: Map<string, string>,
  info: SectionInfo[],
  scope: SecretScope,
): RegionSummary[] {
  const byKey = new Map(info.map((s) => [s.key, s]));
  const out = new Map<string, RegionSummary>();
  for (const el of elements) {
    const key = sections.get(el.token) ?? "page";
    let r = out.get(key);
    if (!r) {
      const s = byKey.get(key);
      r = {
        id: key,
        label: scope.redact(s?.label ?? "Rest of the page"),
        kind: s?.kind ?? "other",
        elementCount: 0,
        sample: [],
      };
      out.set(key, r);
    }
    r.elementCount++;
    const named = el.name.trim();
    const interactive = el.actions.some((a) => a !== "focus" && a !== "scroll_into_view");
    if (interactive && named && r.sample && r.sample.length < SAMPLE_PER_REGION && !r.sample.includes(named))
      r.sample.push(named.slice(0, 60));
  }
  return [...out.values()];
}
