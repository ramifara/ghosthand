// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Playwright traces store typed values (action params, DOM snapshots with input values, request bodies).
// This rewrites a trace zip with every registered secret replaced by its `[input:NAME]` placeholder.
// Minimal zip support: stored and deflated entries, no zip64 (traces that large fail closed).
import { readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import type { Result } from "@ghosthand/protocol";
import { err, ok } from "@ghosthand/protocol";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const SKIP_EXT = /\.(jpe?g|png|webp|gif|woff2?|ttf|otf)$/i;

export interface ZipEntry {
  name: Buffer;
  data: Buffer;
  time: number;
  date: number;
  flags: number;
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === EOCD) return i;
  return -1;
}

/** Reads every entry of a zip (stored or deflated, no zip64), decompressed. */
export function readZipEntries(buf: Buffer): Result<ZipEntry[], string> {
  const eocd = findEocd(buf);
  if (eocd < 0) return err("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return err("zip64 is not supported");
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL) return err("corrupt central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(localOffset) !== LOCAL) return err("corrupt local header");
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else return err(`unsupported compression method ${method}`);
    entries.push({ name: Buffer.from(name), data, time, date, flags: flags & 0x0800 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return ok(entries);
}

function replaceAll(data: Buffer, needle: Buffer, replacement: Buffer): { data: Buffer; hits: number } {
  if (needle.length === 0) return { data, hits: 0 };
  let idx = data.indexOf(needle);
  if (idx < 0) return { data, hits: 0 };
  const parts: Buffer[] = [];
  let last = 0;
  let hits = 0;
  while (idx >= 0) {
    parts.push(data.subarray(last, idx), replacement);
    last = idx + needle.length;
    hits++;
    idx = data.indexOf(needle, last);
  }
  parts.push(data.subarray(last));
  return { data: Buffer.concat(parts), hits };
}

/** Byte forms a value can take inside a trace: raw, JSON-escaped, URL-encoded and form-encoded. */
function variants(value: string): Buffer[] {
  const forms = new Set([
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    encodeURIComponent(value).replace(/%20/g, "+"),
  ]);
  return [...forms].filter((f) => f.length > 0).map((f) => Buffer.from(f, "utf8"));
}

/** Writes entries as a deflated zip. */
export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const compressed = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(e.name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(e.time, 12);
    central.writeUInt16LE(e.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(e.name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, e.name, compressed);
    centrals.push(central, e.name);
    offset += local.length + e.name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * Replaces every secret value in the zip at `path` (in place). Returns the number of replacements.
 * `secrets` are `[name, value]` pairs, longest value first.
 */
export function redactZip(path: string, secrets: Array<[string, string]>): Result<number, string> {
  if (secrets.length === 0) return ok(0);
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch (e) {
    return err(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const entries = readZipEntries(buf);
  if (!entries.ok) return entries;
  let total = 0;
  for (const entry of entries.value) {
    if (SKIP_EXT.test(entry.name.toString("utf8"))) continue;
    for (const [name, value] of secrets) {
      const placeholder = Buffer.from(`[input:${name}]`, "utf8");
      for (const needle of variants(value)) {
        const r = replaceAll(entry.data, needle, placeholder);
        entry.data = r.data;
        total += r.hits;
      }
    }
  }
  if (total === 0) return ok(0);
  try {
    writeFileSync(path, writeZip(entries.value));
  } catch (e) {
    return err(`cannot write ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return ok(total);
}
