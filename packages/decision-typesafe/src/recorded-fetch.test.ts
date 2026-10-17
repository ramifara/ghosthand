// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { recordedFetch } from "./recorded-fetch.ts";

describe("recordedFetch body capture", () => {
  it("decodes a zstd-compressed JSON body", async () => {
    const rec = recordedFetch("systemone-all-types");
    const json = JSON.stringify({ state: "x".repeat(2000), questions: {}, model: "jev-1.13.0" });
    await rec.fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "zstd" },
      body: zstdCompressSync(Buffer.from(json)),
    });
    expect(rec.calls[0]?.body).toEqual(JSON.parse(json));
  });

  it("parses a multipart body into the request JSON and its file parts", async () => {
    const rec = recordedFetch("systemone-all-types");
    const boundary = "abc123";
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\nContent-Type: application/json\r\n\r\n` +
        `{"model":"jev-1.14.0","assets":{"<img>":{"type":"image","part":"shot"}}}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="shot"; filename="shot"\r\nContent-Type: image/png\r\n\r\n`,
    );
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + png.length + tail.length);
    body.set(head, 0);
    body.set(png, head.length);
    body.set(tail, head.length + png.length);
    await rec.fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const call = rec.calls[0];
    expect(call?.body).toEqual({ model: "jev-1.14.0", assets: { "<img>": { type: "image", part: "shot" } } });
    expect(call?.parts).toEqual([{ name: "shot", contentType: "image/png", bytes: png }]);
  });
});
