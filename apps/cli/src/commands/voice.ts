// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// `ghosthand voice transcribe | models | parse`: debugging and setup for voice-guided mode.
import { readFileSync } from "node:fs";
import { createVoiceModels, createVoiceStt, openRuntime } from "@ghosthand/engine";
import {
  decodeWav,
  describeCommand,
  isSttBackendId,
  type ModelManager,
  type ParseResult,
  parseUtterance,
  resample,
  STT_SAMPLE_RATE,
  type SttBackendId,
} from "@ghosthand/voice";
import { fail, out } from "../io.ts";

export interface VoiceFlags {
  json: boolean;
  backend?: string;
  model?: string;
  language?: string;
  modelsDir?: string;
}

export const VOICE_HELP = `ghosthand voice

Usage:
  ghosthand voice transcribe <file.wav> [--backend auto|moonshine|whisper|openai|deepgram] [--model <id>] [--language en]
  ghosthand voice models list
  ghosthand voice models download <id>
  ghosthand voice models verify <id>
  ghosthand voice models remove <id>
  ghosthand voice parse "<utterance>"
`;

export async function voiceCommand(args: string[], flags: VoiceFlags): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "transcribe":
      return transcribe(rest[0], flags);
    case "models":
      return models(rest, flags);
    case "parse":
      return parse(rest.join(" "), flags);
    default:
      if (sub) return fail(`unknown voice subcommand "${sub}"\n\n${VOICE_HELP}`, 2);
      out(VOICE_HELP);
      return 2;
  }
}

// ---------------------------------------------------------------------------------------------------------

export function formatParse(r: ParseResult): string {
  switch (r.kind) {
    case "command":
      return `command  ${describeCommand(r.command)}`;
    case "goal":
      return `goal     ${JSON.stringify(r.goal)} (planner)`;
    case "unknown":
      return `unknown  ${JSON.stringify(r.utterance)} (Jev intent step)`;
    case "empty":
      return "empty";
  }
}

function parse(utterance: string, flags: VoiceFlags): number {
  if (!utterance.trim()) return fail('usage: ghosthand voice parse "<utterance>"', 2);
  const r = parseUtterance(utterance);
  out(flags.json ? JSON.stringify(r, null, 2) : formatParse(r));
  return 0;
}

// ---------------------------------------------------------------------------------------------------------

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

async function models(args: string[], flags: VoiceFlags): Promise<number> {
  const [action = "list", id] = args;
  const mm: ModelManager = createVoiceModels(flags.modelsDir ? { modelsDir: flags.modelsDir } : {});
  if (action === "list") {
    const rows = mm.list();
    if (flags.json) {
      out(
        JSON.stringify(
          rows.map((r) => ({
            id: r.model.id,
            engine: r.model.engine,
            title: r.model.title,
            languages: r.model.languages,
            sizeBytes: r.model.sizeBytes,
            installed: r.installed,
            partialBytes: r.partialBytes,
            dir: r.dir,
          })),
          null,
          2,
        ),
      );
      return 0;
    }
    out(`models dir: ${mm.root}`);
    for (const r of rows) {
      const state = r.installed ? "installed" : r.partialBytes > 0 ? `partial ${mb(r.partialBytes)}` : "-";
      const dflt = r.model.default ? "*" : " ";
      out(
        `${dflt} ${r.model.id.padEnd(20)} ${r.model.engine.padEnd(10)} ${mb(r.model.sizeBytes).padStart(9)}  ${state.padEnd(14)} ${r.model.title}`,
      );
    }
    return 0;
  }
  if (!id) return fail(`usage: ghosthand voice models ${action} <id>`, 2);
  if (action === "download") {
    let lastPct = -1;
    const r = await mm.download(id, {
      onProgress: (p) => {
        const pct = Math.floor((p.receivedBytes / Math.max(1, p.totalBytes)) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          process.stderr.write(
            `\r${id}: ${pct}% (${mb(p.receivedBytes)} / ${mb(p.totalBytes)}) ${p.file}   `,
          );
        }
      },
    });
    process.stderr.write("\n");
    if (!r.ok) return fail(`${r.error.kind}: ${r.error.message}`);
    out(flags.json ? JSON.stringify(r.value, null, 2) : `installed ${id} in ${r.value.dir}`);
    return 0;
  }
  if (action === "verify") {
    const r = await mm.verify(id);
    if (!r.ok) return fail(`${r.error.kind}: ${r.error.message}`);
    out(
      flags.json
        ? JSON.stringify(r.value, null, 2)
        : r.value.valid
          ? `${id}: OK`
          : r.value.problems.join("\n"),
    );
    return r.value.valid ? 0 : 1;
  }
  if (action === "remove") {
    const r = await mm.remove(id);
    if (!r.ok) return fail(`${r.error.kind}: ${r.error.message}`);
    out(r.value ? `removed ${id}` : `${id} was not installed`);
    return 0;
  }
  return fail(`unknown models action "${action}" (expected list, download, verify, remove)`, 2);
}

// ---------------------------------------------------------------------------------------------------------

async function transcribe(file: string | undefined, flags: VoiceFlags): Promise<number> {
  if (!file) return fail("usage: ghosthand voice transcribe <file.wav> [--backend ...]", 2);
  const backend = flags.backend ?? "auto";
  if (backend !== "auto" && !isSttBackendId(backend)) return fail(`unknown backend "${backend}"`, 2);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const wav = decodeWav(bytes);
  if (!wav.ok) return fail(wav.error.message);
  const samples = resample(wav.value.samples, wav.value.sampleRate, STT_SAMPLE_RATE);
  const rt = await openRuntime({ logLevel: "silent" });
  if (!rt.ok) return fail(rt.error.message);
  const stt = createVoiceStt(rt.value, backend as SttBackendId | "auto", {
    ...(flags.model ? { modelId: flags.model } : {}),
    ...(flags.language ? { language: flags.language } : {}),
    ...(flags.modelsDir ? { modelsDir: flags.modelsDir } : {}),
  });
  if (!stt.ok) return fail(stt.error);
  const r = await stt.value.transcribe(samples, flags.language ? { language: flags.language } : {});
  stt.value.close?.();
  if (!r.ok) return fail(`${r.error.backend}: ${r.error.kind}: ${r.error.message}`);
  if (flags.json) {
    out(JSON.stringify({ ...r.value, rtf: r.value.latencyMs / Math.max(1, r.value.audioMs) }, null, 2));
  } else {
    out(r.value.text);
    process.stderr.write(
      `${r.value.backend}:${r.value.model} · ${Math.round(r.value.audioMs)} ms audio · ${Math.round(r.value.latencyMs)} ms (RTF ${(r.value.latencyMs / Math.max(1, r.value.audioMs)).toFixed(3)})\n`,
    );
  }
  return 0;
}
