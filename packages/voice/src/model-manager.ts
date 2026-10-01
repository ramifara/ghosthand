// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Lists, downloads (resumable, SHA-256 verified), verifies and removes STT/VAD models under
// <root>/<id>/. Partial downloads stay as `<file>.part` and resume with an HTTP Range request.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { err, ok, type Result } from "@ghosthand/protocol";
import { z } from "zod";
import { type CatalogModel, findCatalogModel, sttModelCatalog } from "./model-catalog.ts";
import { defaultSttModelsDir } from "./models-dir.ts";

export const MANIFEST_FILE = "ghosthand-model.json";
const DOWNLOADS_DIR = ".downloads";

export type ModelManagerErrorKind =
  | "unknown_model"
  | "not_installed"
  | "network"
  | "http"
  | "checksum"
  | "io"
  | "extract"
  | "aborted";

export interface ModelManagerError {
  kind: ModelManagerErrorKind;
  message: string;
  modelId: string;
  status?: number;
}

export interface DownloadProgress {
  modelId: string;
  /** File or archive name being fetched. */
  file: string;
  fileIndex: number;
  fileCount: number;
  /** Bytes on disk for the whole model so far, including resumed bytes. */
  receivedBytes: number;
  totalBytes: number;
  /** Bytes this file resumed from (0 for a fresh download). */
  resumedFrom: number;
}

export interface InstalledModel {
  id: string;
  engine: CatalogModel["engine"];
  dir: string;
  /** Role → absolute path (encoder, decoder, mergedDecoder, tokens, model). */
  files: Record<string, string>;
}

export interface ModelStatus {
  model: CatalogModel;
  installed: boolean;
  dir: string;
  /** Bytes of unfinished `.part` downloads, for "resume" in the UI. */
  partialBytes: number;
}

export interface VerifyReport {
  id: string;
  valid: boolean;
  /** One line per missing or mismatched file. */
  problems: string[];
}

const ManifestEntry = z.object({ path: z.string(), sha256: z.string(), size: z.number() });
const Manifest = z.object({
  id: z.string(),
  installedAt: z.string(),
  sources: z.array(z.string()),
  files: z.array(ManifestEntry),
});
type Manifest = z.infer<typeof Manifest>;

/** Extracts a .tar.bz2 archive into `dest`. Injected in tests; the default shells out to `tar`. */
export type ArchiveExtractor = (archive: string, dest: string) => Promise<Result<void, string>>;

export const tarExtractor: ArchiveExtractor = (archive, dest) =>
  new Promise((done) => {
    execFile("tar", ["-xjf", archive, "-C", dest], { windowsHide: true }, (e, _stdout, stderr) => {
      done(e ? err(`tar failed: ${stderr.trim() || e.message}`) : ok(undefined));
    });
  });

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ModelManagerOptions {
  root?: string;
  catalog?: CatalogModel[];
  fetch?: FetchLike;
  extract?: ArchiveExtractor;
}

export interface DownloadOptions {
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
}

export interface ModelManager {
  readonly root: string;
  list(): ModelStatus[];
  /** Installed model with resolved file paths (no hashing; see `verify`). */
  resolve(id: string): Result<InstalledModel, ModelManagerError>;
  download(id: string, opts?: DownloadOptions): Promise<Result<InstalledModel, ModelManagerError>>;
  verify(id: string): Promise<Result<VerifyReport, ModelManagerError>>;
  /** Removes the model folder and any partial download. Returns false when nothing was there. */
  remove(id: string): Promise<Result<boolean, ModelManagerError>>;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const fileSize = (path: string): number => (existsSync(path) ? statSync(path).size : 0);

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createModelManager(opts: ModelManagerOptions = {}): ModelManager {
  const root = resolve(opts.root ?? defaultSttModelsDir());
  const catalog = opts.catalog ?? sttModelCatalog();
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const extract = opts.extract ?? tarExtractor;

  const modelDir = (id: string): string => {
    const dir = resolve(root, id);
    if (!dir.startsWith(root + sep)) throw new Error(`model id escapes the models root: ${id}`);
    return dir;
  };
  const downloadsDir = join(root, DOWNLOADS_DIR);
  const fail = (modelId: string, kind: ModelManagerErrorKind, msg: string, status?: number) =>
    err<ModelManagerError>({ kind, message: msg, modelId, ...(status !== undefined ? { status } : {}) });

  const lookup = (id: string): Result<CatalogModel, ModelManagerError> => {
    const model = findCatalogModel(id, catalog);
    return model ? ok(model) : fail(id, "unknown_model", `unknown model "${id}"`);
  };

  const readManifest = (dir: string): Manifest | undefined => {
    const path = join(dir, MANIFEST_FILE);
    if (!existsSync(path)) return undefined;
    try {
      const parsed = Manifest.safeParse(JSON.parse(readFileSync(path, "utf8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  };

  const installed = (model: CatalogModel): InstalledModel | undefined => {
    const dir = modelDir(model.id);
    if (!readManifest(dir)) return undefined;
    const files: Record<string, string> = {};
    for (const [role, rel] of Object.entries(model.layout)) {
      const path = join(dir, rel);
      if (!existsSync(path)) return undefined;
      files[role] = path;
    }
    return { id: model.id, engine: model.engine, dir, files };
  };

  const partialBytes = (model: CatalogModel): number => {
    if (model.archive) return fileSize(join(downloadsDir, `${model.id}.tar.bz2.part`));
    const dir = modelDir(model.id);
    return (model.files ?? []).reduce((n, f) => n + fileSize(join(dir, `${f.path}.part`)), 0);
  };

  /** Fetches `url` into `dest` via `dest.part`, resuming, then checks size and SHA-256. */
  async function fetchVerified(
    model: CatalogModel,
    spec: { url: string; sha256: string; size: number; name: string },
    dest: string,
    progress: { index: number; count: number; doneBefore: number; total: number },
    dl: DownloadOptions,
  ): Promise<Result<void, ModelManagerError>> {
    const part = `${dest}.part`;
    await mkdir(dirname(dest), { recursive: true });
    let start = fileSize(part);
    if (start > spec.size) {
      await rm(part, { force: true });
      start = 0;
    }
    const report = (bytes: number, resumedFrom: number) =>
      dl.onProgress?.({
        modelId: model.id,
        file: spec.name,
        fileIndex: progress.index,
        fileCount: progress.count,
        receivedBytes: progress.doneBefore + bytes,
        totalBytes: progress.total,
        resumedFrom,
      });
    if (start < spec.size) {
      let res: Response;
      try {
        res = await doFetch(spec.url, {
          redirect: "follow",
          headers: start > 0 ? { Range: `bytes=${start}-` } : {},
          ...(dl.signal ? { signal: dl.signal } : {}),
        });
      } catch (e) {
        return fail(model.id, dl.signal?.aborted ? "aborted" : "network", `${spec.name}: ${message(e)}`);
      }
      if (res.status === 416 && start > 0) {
        // The server says we already have everything; fall through to the checksum.
      } else if (res.status !== 200 && res.status !== 206) {
        return fail(model.id, "http", `${spec.name}: HTTP ${res.status}`, res.status);
      } else {
        // 200 means the server ignored the Range header: start over.
        if (res.status === 200) start = 0;
        const resumedFrom = start;
        // Synchronous writes keep up with the socket: when a connection drops, a stream errors and
        // discards chunks still queued, so consuming each chunk at once keeps more for the resume.
        const fd = openSync(part, start > 0 ? "a" : "w", 0o644);
        let bytes = start;
        try {
          if (res.body) {
            for await (const chunk of res.body) {
              writeSync(fd, chunk);
              bytes += chunk.byteLength;
              report(bytes, resumedFrom);
            }
          }
        } catch (e) {
          return fail(model.id, dl.signal?.aborted ? "aborted" : "network", `${spec.name}: ${message(e)}`);
        } finally {
          closeSync(fd);
        }
      }
    }
    const got = fileSize(part);
    if (got !== spec.size) {
      if (got > spec.size) await rm(part, { force: true });
      return fail(model.id, "checksum", `${spec.name}: got ${got} bytes, expected ${spec.size}`);
    }
    const sha = await sha256File(part);
    if (sha !== spec.sha256) {
      await rm(part, { force: true });
      return fail(model.id, "checksum", `${spec.name}: SHA-256 ${sha} does not match ${spec.sha256}`);
    }
    await rename(part, dest);
    report(spec.size, 0);
    return ok(undefined);
  }

  async function writeManifest(model: CatalogModel, dir: string, entries: Manifest["files"]) {
    const sources = model.archive ? [model.archive.url] : (model.files ?? []).map((f) => f.url);
    const manifest: Manifest = {
      id: model.id,
      installedAt: new Date().toISOString(),
      sources,
      files: entries,
    };
    await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  async function listFiles(dir: string, base = dir): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await listFiles(path, base)));
      else if (entry.isFile() && entry.name !== MANIFEST_FILE) out.push(relative(base, path));
    }
    return out.sort();
  }

  async function downloadFiles(
    model: CatalogModel,
    files: NonNullable<CatalogModel["files"]>,
    dl: DownloadOptions,
  ) {
    const dir = modelDir(model.id);
    const total = files.reduce((n, f) => n + f.size, 0);
    let doneBefore = 0;
    for (const [index, f] of files.entries()) {
      const dest = join(dir, f.path);
      const already = fileSize(dest) === f.size && (await sha256File(dest)) === f.sha256;
      if (!already) {
        const r = await fetchVerified(
          model,
          { url: f.url, sha256: f.sha256, size: f.size, name: f.path },
          dest,
          { index, count: files.length, doneBefore, total },
          dl,
        );
        if (!r.ok) return r;
      }
      doneBefore += f.size;
    }
    await writeManifest(
      model,
      dir,
      files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })),
    );
    return ok(undefined);
  }

  async function downloadArchive(
    model: CatalogModel,
    archive: NonNullable<CatalogModel["archive"]>,
    dl: DownloadOptions,
  ): Promise<Result<void, ModelManagerError>> {
    const file = join(downloadsDir, `${model.id}.tar.bz2`);
    const name = archive.url.split("/").pop() ?? `${model.id}.tar.bz2`;
    const fetched = await fetchVerified(
      model,
      { url: archive.url, sha256: archive.sha256, size: archive.size, name },
      file,
      { index: 0, count: 1, doneBefore: 0, total: archive.size },
      dl,
    );
    if (!fetched.ok) return fetched;
    const staging = join(root, `.staging-${model.id}`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const extracted = await extract(file, staging);
    if (!extracted.ok) {
      await rm(staging, { recursive: true, force: true });
      return fail(model.id, "extract", extracted.error);
    }
    const inner = resolve(staging, archive.root);
    if (!inner.startsWith(staging + sep) || !existsSync(inner)) {
      await rm(staging, { recursive: true, force: true });
      return fail(model.id, "extract", `archive has no folder ${archive.root}`);
    }
    const dir = modelDir(model.id);
    await rm(dir, { recursive: true, force: true });
    await rename(inner, dir);
    await rm(staging, { recursive: true, force: true });
    await rm(file, { force: true });
    const entries: Manifest["files"] = [];
    for (const rel of await listFiles(dir)) {
      const path = join(dir, rel);
      entries.push({ path: rel.split(sep).join("/"), sha256: await sha256File(path), size: fileSize(path) });
    }
    await writeManifest(model, dir, entries);
    return ok(undefined);
  }

  return {
    root,

    list() {
      return catalog.map((model) => ({
        model,
        installed: installed(model) !== undefined,
        dir: modelDir(model.id),
        partialBytes: partialBytes(model),
      }));
    },

    resolve(id) {
      const model = lookup(id);
      if (!model.ok) return model;
      const inst = installed(model.value);
      return inst
        ? ok(inst)
        : fail(id, "not_installed", `model "${id}" is not installed (ghosthand voice models download ${id})`);
    },

    async download(id, dl = {}) {
      const found = lookup(id);
      if (!found.ok) return found;
      const model = found.value;
      try {
        const r = model.archive
          ? await downloadArchive(model, model.archive, dl)
          : await downloadFiles(model, model.files ?? [], dl);
        if (!r.ok) return r;
      } catch (e) {
        return fail(id, dl.signal?.aborted ? "aborted" : "io", message(e));
      }
      const inst = installed(model);
      return inst ? ok(inst) : fail(id, "io", `model "${id}" is missing files after download`);
    },

    async verify(id) {
      const found = lookup(id);
      if (!found.ok) return found;
      const model = found.value;
      const dir = modelDir(model.id);
      const manifest = readManifest(dir);
      if (!manifest) return fail(id, "not_installed", `model "${id}" is not installed`);
      const problems: string[] = [];
      const expected = new Map(manifest.files.map((f) => [f.path, f.sha256]));
      // Catalog hashes win over the manifest for directly downloaded files.
      for (const f of model.files ?? []) expected.set(f.path, f.sha256);
      for (const rel of Object.values(model.layout))
        if (!expected.has(rel)) problems.push(`${rel}: not in manifest`);
      try {
        for (const [rel, sha] of expected) {
          const path = join(dir, rel);
          if (!existsSync(path)) problems.push(`${rel}: missing`);
          else if ((await sha256File(path)) !== sha) problems.push(`${rel}: SHA-256 mismatch`);
        }
      } catch (e) {
        return fail(id, "io", message(e));
      }
      return ok({ id, valid: problems.length === 0, problems });
    },

    async remove(id) {
      const found = lookup(id);
      if (!found.ok) return found;
      const dir = modelDir(id);
      const archivePart = join(downloadsDir, `${id}.tar.bz2.part`);
      const existed = existsSync(dir) || existsSync(archivePart);
      try {
        await rm(dir, { recursive: true, force: true });
        await rm(archivePart, { force: true });
        await rm(join(downloadsDir, `${id}.tar.bz2`), { force: true });
      } catch (e) {
        return fail(id, "io", message(e));
      }
      return ok(existed);
    },
  };
}
