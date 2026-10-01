// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// CDP `Page.startScreencast` on the agent's page, for the desktop live view. Frames are only handed to the
// caller (never written to disk); every frame is acknowledged so Chromium keeps sending them.
import type { ComputerError, Result, ScreencastFrame } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";
import type { CDPSession, Page } from "playwright-core";

export interface ScreencastOptions {
  format?: "jpeg" | "png";
  /** JPEG quality 0-100. */
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
}

export const DEFAULT_SCREENCAST: Required<ScreencastOptions> = {
  format: "jpeg",
  quality: 60,
  maxWidth: 1280,
  maxHeight: 960,
  everyNthFrame: 1,
};

export type FrameListener = (frame: ScreencastFrame) => void;

export interface ScreencastHandle {
  readonly page: Page;
  stop(): Promise<void>;
}

interface CdpFrameEvent {
  data: string;
  sessionId: number;
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
}

const message = (e: unknown): string => (e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e));

/** Maps a CDP frame event to the protocol shape. Exported for tests. */
export function toScreencastFrame(event: CdpFrameEvent, format: "jpeg" | "png"): ScreencastFrame {
  const m = event.metadata;
  return {
    data: event.data,
    mimeType: format === "png" ? "image/png" : "image/jpeg",
    metadata: {
      deviceWidth: m.deviceWidth > 0 ? m.deviceWidth : 1,
      deviceHeight: m.deviceHeight > 0 ? m.deviceHeight : 1,
      offsetTop: m.offsetTop,
      pageScaleFactor: m.pageScaleFactor > 0 ? m.pageScaleFactor : 1,
      scrollOffsetX: m.scrollOffsetX,
      scrollOffsetY: m.scrollOffsetY,
      ...(m.timestamp !== undefined ? { timestamp: m.timestamp } : {}),
    },
  };
}

export async function startPageScreencast(
  page: Page,
  onFrame: FrameListener,
  options: ScreencastOptions = {},
): Promise<Result<ScreencastHandle, ComputerError>> {
  const opts = { ...DEFAULT_SCREENCAST, ...options };
  let session: CDPSession;
  try {
    session = await page.context().newCDPSession(page);
  } catch (e) {
    return err({ kind: page.isClosed() ? "closed" : "driver", message: `screencast: ${message(e)}` });
  }
  let stopped = false;
  const onEvent = (event: CdpFrameEvent): void => {
    if (stopped) return;
    void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    try {
      onFrame(toScreencastFrame(event, opts.format));
    } catch {
      // A failing listener must not stop the stream.
    }
  };
  session.on("Page.screencastFrame", onEvent);
  try {
    await session.send("Page.startScreencast", {
      format: opts.format,
      quality: opts.quality,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
      everyNthFrame: opts.everyNthFrame,
    });
  } catch (e) {
    session.off("Page.screencastFrame", onEvent);
    await session.detach().catch(() => {});
    return err({ kind: "driver", message: `screencast: ${message(e)}` });
  }
  return ok({
    page,
    async stop() {
      if (stopped) return;
      stopped = true;
      session.off("Page.screencastFrame", onEvent);
      await session.send("Page.stopScreencast").catch(() => {});
      await session.detach().catch(() => {});
    },
  });
}
