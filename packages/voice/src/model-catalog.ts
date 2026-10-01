// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Known downloadable STT/VAD models for sherpa-onnx. URLs are pinned (GitHub release assets with published
// digests, Hugging Face files at a fixed revision) and every file carries its SHA-256.
// Only English Moonshine models are listed: Moonshine's other-language models use a non-commercial license.
import { z } from "zod";
import bundled from "./stt-models.json" with { type: "json" };

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** Relative path inside a model folder; no absolute paths, no "..". */
const RelPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."), "must be a relative path");

export const ModelFile = z.object({
  path: RelPath,
  url: z.url(),
  sha256: Sha256,
  size: z.number().int().positive(),
});
export type ModelFile = z.infer<typeof ModelFile>;

export const ModelArchive = z.object({
  url: z.url(),
  sha256: Sha256,
  size: z.number().int().positive(),
  format: z.literal("tar.bz2"),
  /** Top-level folder inside the archive; its contents become the model folder. */
  root: RelPath,
});
export type ModelArchive = z.infer<typeof ModelArchive>;

export const ModelEngine = z.enum(["moonshine", "whisper", "silero-vad"]);
export type ModelEngine = z.infer<typeof ModelEngine>;

export const CatalogModel = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    engine: ModelEngine,
    title: z.string(),
    /** ISO-639-1 codes, or ["multi"]. */
    languages: z.array(z.string()).min(1),
    license: z.string(),
    homepage: z.url(),
    /** Suggested by default for its engine. */
    default: z.boolean(),
    sizeBytes: z.number().int().positive(),
    files: z.array(ModelFile).min(1).optional(),
    archive: ModelArchive.optional(),
    /** Role → relative file path (encoder, decoder, mergedDecoder, tokens, model). */
    layout: z.record(z.string(), RelPath),
  })
  .refine((m) => (m.files === undefined) !== (m.archive === undefined), "exactly one of files or archive");
export type CatalogModel = z.infer<typeof CatalogModel>;

export const ModelCatalogFile = z.object({ version: z.literal(1), models: z.array(CatalogModel) });
export type ModelCatalogFile = z.infer<typeof ModelCatalogFile>;

let cached: CatalogModel[] | undefined;

/** The bundled catalog, validated once. A broken catalog is a programmer error. */
export function sttModelCatalog(): CatalogModel[] {
  cached ??= ModelCatalogFile.parse(bundled).models;
  return cached;
}

export function findCatalogModel(id: string, catalog = sttModelCatalog()): CatalogModel | undefined {
  return catalog.find((m) => m.id === id);
}

/** Default model id for an engine (e.g. "moonshine-tiny-en"). */
export function defaultModelId(engine: ModelEngine, catalog = sttModelCatalog()): string | undefined {
  return (catalog.find((m) => m.engine === engine && m.default) ?? catalog.find((m) => m.engine === engine))
    ?.id;
}
