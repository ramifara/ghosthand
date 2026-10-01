// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CatalogModel, sttModelCatalog } from "./model-catalog.ts";
import { createModelManager, type DownloadProgress, MANIFEST_FILE } from "./model-manager.ts";
import { defaultSttModelsDir } from "./models-dir.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

const ENCODER = bytes(50_000, 1);
const TOKENS = new TextEncoder().encode("a 0\nb 1\n");

/** Files served by the fake model host. `cutAfter` drops the connection after N bytes once. */
const served = new Map<string, Uint8Array>();
const requests: Array<{ path: string; range?: string }> = [];
let cutAfter: number | undefined;
let ignoreRange = false;
let server: Server;
let base = "";
let root = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    const range = req.headers.range;
    requests.push({ path, ...(range ? { range } : {}) });
    const body = served.get(path);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    let start = 0;
    const m = range && !ignoreRange ? /^bytes=(\d+)-$/.exec(range) : null;
    if (m) {
      start = Number(m[1]);
      if (start >= body.length) {
        res.writeHead(416).end();
        return;
      }
      res.writeHead(206, { "Content-Length": body.length - start });
    } else {
      res.writeHead(200, { "Content-Length": body.length });
    }
    const slice = body.subarray(start);
    if (cutAfter !== undefined) {
      const n = cutAfter;
      cutAfter = undefined;
      res.write(slice.subarray(0, n), () => res.destroy());
      return;
    }
    res.end(slice);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gh-models-"));
  requests.length = 0;
  cutAfter = undefined;
  ignoreRange = false;
  served.clear();
  served.set("/m/encoder.onnx", ENCODER);
  served.set("/m/tokens.txt", TOKENS);
});

const filesModel = (): CatalogModel => ({
  id: "whisper-test",
  engine: "whisper",
  title: "Test Whisper",
  languages: ["en"],
  license: "MIT",
  homepage: "https://example.com/",
  default: true,
  sizeBytes: ENCODER.length + TOKENS.length,
  files: [
    { path: "encoder.onnx", url: `${base}/m/encoder.onnx`, sha256: sha(ENCODER), size: ENCODER.length },
    { path: "tokens.txt", url: `${base}/m/tokens.txt`, sha256: sha(TOKENS), size: TOKENS.length },
  ],
  layout: { encoder: "encoder.onnx", decoder: "encoder.onnx", tokens: "tokens.txt" },
});

describe("model manager (files)", () => {
  it("downloads, verifies with SHA-256, reports progress, and resolves paths", async () => {
    const model = filesModel();
    const mm = createModelManager({ root, catalog: [model] });
    expect(mm.list()[0]?.installed).toBe(false);
    const progress: DownloadProgress[] = [];
    const r = await mm.download("whisper-test", { onProgress: (p) => progress.push(p) });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(root, "whisper-test", "encoder.onnx"))).toEqual(Buffer.from(ENCODER));
    expect(existsSync(join(root, "whisper-test", MANIFEST_FILE))).toBe(true);
    const last = progress[progress.length - 1];
    expect(last?.receivedBytes).toBe(model.sizeBytes);
    expect(last?.totalBytes).toBe(model.sizeBytes);
    expect(mm.list()[0]?.installed).toBe(true);
    const resolved = mm.resolve("whisper-test");
    expect(resolved.ok && resolved.value.files.tokens).toBe(join(root, "whisper-test", "tokens.txt"));
    expect((await mm.verify("whisper-test")).ok).toBe(true);
  });

  it("skips files already present on a second download", async () => {
    const mm = createModelManager({ root, catalog: [filesModel()] });
    await mm.download("whisper-test");
    requests.length = 0;
    expect((await mm.download("whisper-test")).ok).toBe(true);
    expect(requests).toEqual([]);
  });

  it("resumes an interrupted download with a Range request", async () => {
    const mm = createModelManager({ root, catalog: [filesModel()] });
    cutAfter = 20_000;
    const first = await mm.download("whisper-test");
    expect(first.ok).toBe(false);
    const partial = mm.list()[0]?.partialBytes ?? 0;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(ENCODER.length);
    const second = await mm.download("whisper-test");
    expect(second.ok).toBe(true);
    expect(requests.some((q) => q.range === `bytes=${partial}-`)).toBe(true);
    expect(readFileSync(join(root, "whisper-test", "encoder.onnx"))).toEqual(Buffer.from(ENCODER));
  });

  it("starts over when the server ignores Range", async () => {
    const mm = createModelManager({ root, catalog: [filesModel()] });
    mkdirSync(join(root, "whisper-test"), { recursive: true });
    writeFileSync(join(root, "whisper-test", "encoder.onnx.part"), ENCODER.subarray(0, 1000));
    ignoreRange = true;
    expect((await mm.download("whisper-test")).ok).toBe(true);
    expect(readFileSync(join(root, "whisper-test", "encoder.onnx"))).toEqual(Buffer.from(ENCODER));
  });

  it("rejects a checksum mismatch and deletes the bad file", async () => {
    served.set("/m/encoder.onnx", bytes(ENCODER.length, 9));
    const mm = createModelManager({ root, catalog: [filesModel()] });
    const r = await mm.download("whisper-test");
    expect(r.ok ? "ok" : r.error.kind).toBe("checksum");
    expect(existsSync(join(root, "whisper-test", "encoder.onnx"))).toBe(false);
    expect(existsSync(join(root, "whisper-test", "encoder.onnx.part"))).toBe(false);
  });

  it("maps HTTP errors and unknown ids", async () => {
    served.delete("/m/tokens.txt");
    const mm = createModelManager({ root, catalog: [filesModel()] });
    const r = await mm.download("whisper-test");
    expect(r.ok ? "ok" : [r.error.kind, r.error.status]).toEqual(["http", 404]);
    const u = await mm.download("nope");
    expect(u.ok ? "ok" : u.error.kind).toBe("unknown_model");
    const n = mm.resolve("whisper-test");
    expect(n.ok ? "ok" : n.error.kind).toBe("not_installed");
  });

  it("verify detects a corrupted file; remove deletes the folder", async () => {
    const mm = createModelManager({ root, catalog: [filesModel()] });
    await mm.download("whisper-test");
    writeFileSync(join(root, "whisper-test", "tokens.txt"), "tampered");
    const v = await mm.verify("whisper-test");
    expect(v.ok && v.value).toEqual({
      id: "whisper-test",
      valid: false,
      problems: ["tokens.txt: SHA-256 mismatch"],
    });
    expect(await mm.remove("whisper-test")).toEqual({ ok: true, value: true });
    expect(existsSync(join(root, "whisper-test"))).toBe(false);
    expect(await mm.remove("whisper-test")).toEqual({ ok: true, value: false });
  });
});

const hasTar = (() => {
  try {
    execFileSync("tar", ["--version"], { stdio: "ignore" });
    execFileSync("bzip2", ["--help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTar)("model manager (tar.bz2 archive)", () => {
  it("downloads, verifies, extracts and writes a manifest", async () => {
    const src = mkdtempSync(join(tmpdir(), "gh-archive-"));
    mkdirSync(join(src, "pkg-1", "test_wavs"), { recursive: true });
    writeFileSync(join(src, "pkg-1", "encoder_model.ort"), ENCODER);
    writeFileSync(join(src, "pkg-1", "decoder_model_merged.ort"), ENCODER.subarray(0, 100));
    writeFileSync(join(src, "pkg-1", "tokens.txt"), TOKENS);
    writeFileSync(join(src, "pkg-1", "test_wavs", "0.wav"), "x");
    execFileSync("tar", ["-cjf", join(src, "pkg.tar.bz2"), "-C", src, "pkg-1"]);
    const archive = readFileSync(join(src, "pkg.tar.bz2"));
    served.set("/a/pkg.tar.bz2", archive);
    const model: CatalogModel = {
      id: "moonshine-test",
      engine: "moonshine",
      title: "Test Moonshine",
      languages: ["en"],
      license: "MIT",
      homepage: "https://example.com/",
      default: true,
      sizeBytes: archive.length,
      archive: {
        url: `${base}/a/pkg.tar.bz2`,
        sha256: sha(archive),
        size: archive.length,
        format: "tar.bz2",
        root: "pkg-1",
      },
      layout: {
        encoder: "encoder_model.ort",
        mergedDecoder: "decoder_model_merged.ort",
        tokens: "tokens.txt",
      },
    };
    const mm = createModelManager({ root, catalog: [model] });
    const r = await mm.download("moonshine-test");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.files.mergedDecoder).toBe(join(root, "moonshine-test", "decoder_model_merged.ort"));
    expect(existsSync(join(root, ".downloads", "moonshine-test.tar.bz2"))).toBe(false);
    const v = await mm.verify("moonshine-test");
    expect(v.ok && v.value.valid).toBe(true);
    const manifest = JSON.parse(readFileSync(join(root, "moonshine-test", MANIFEST_FILE), "utf8"));
    expect(manifest.files.map((f: { path: string }) => f.path)).toContain("test_wavs/0.wav");
    rmSync(src, { recursive: true, force: true });
  });

  it("reports extraction failures", async () => {
    const junk = bytes(1000, 3);
    served.set("/a/junk.tar.bz2", junk);
    const model: CatalogModel = {
      ...filesModel(),
      id: "junk",
      files: undefined,
      archive: {
        url: `${base}/a/junk.tar.bz2`,
        sha256: sha(junk),
        size: junk.length,
        format: "tar.bz2",
        root: "x",
      },
    } as CatalogModel;
    const mm = createModelManager({ root, catalog: [model] });
    const r = await mm.download("junk");
    expect(r.ok ? "ok" : r.error.kind).toBe("extract");
  });
});

describe("bundled catalog", () => {
  const catalog = sttModelCatalog();

  it("lists Moonshine, Whisper and Silero with pinned hashes", () => {
    expect(catalog.filter((m) => m.engine === "moonshine").length).toBeGreaterThanOrEqual(2);
    expect(catalog.filter((m) => m.engine === "whisper").length).toBeGreaterThanOrEqual(4);
    expect(catalog.find((m) => m.id === "silero-vad")).toBeDefined();
    for (const m of catalog) {
      const urls = m.archive ? [m.archive.url] : (m.files ?? []).map((f) => f.url);
      for (const u of urls) expect(u.startsWith("https://")).toBe(true);
      // Hugging Face files are pinned to a commit, not "main".
      for (const u of urls) expect(u).not.toContain("/resolve/main/");
    }
  });

  it("has one default per engine and only permissively licensed models", () => {
    for (const engine of ["moonshine", "whisper", "silero-vad"] as const) {
      expect(catalog.filter((m) => m.engine === engine && m.default).length).toBeLessThanOrEqual(1);
    }
    expect(catalog.every((m) => m.license === "MIT")).toBe(true);
    expect(catalog.find((m) => m.engine === "moonshine" && m.default)?.id).toBe("moonshine-tiny-en");
  });

  it("puts models under XDG_DATA_HOME", () => {
    expect(defaultSttModelsDir({ env: { XDG_DATA_HOME: "/data" }, platform: "linux", home: "/home/u" })).toBe(
      "/data/ghosthand/models/stt",
    );
    expect(defaultSttModelsDir({ env: {}, platform: "linux", home: "/home/u" })).toBe(
      "/home/u/.local/share/ghosthand/models/stt",
    );
    expect(defaultSttModelsDir({ env: { GHOSTHAND_MODELS_DIR: "/m" }, platform: "linux", home: "/h" })).toBe(
      "/m/stt",
    );
  });
});
