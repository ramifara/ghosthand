// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Regenerates packages/models/src/catalog/models-snapshot.json from models.dev. Reads a local
// models.dev checkout when one exists (TOML sources, resolved like models.dev's own generator),
// otherwise fetches https://models.dev/api.json. Needs no key; never run in CI.
//
//   node scripts/models-snapshot.ts [--refs research/refs/models.dev] [--fetch] [--url URL] [--out FILE]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildModelsSnapshot, DEFAULT_SNAPSHOT_SELECTION } from "@ghosthand/models";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    refs: { type: "string", default: join(root, "research", "refs", "models.dev") },
    fetch: { type: "boolean", default: false },
    url: { type: "string", default: "https://models.dev/api.json" },
    out: {
      type: "string",
      default: join(root, "packages", "models", "src", "catalog", "models-snapshot.json"),
    },
  },
});

// ---------------------------------------------------------------------------------------------
// A TOML reader for the subset models.dev uses: comments, [table] and [[array.of.tables]] headers,
// key = value with basic/literal strings, numbers (with _), booleans, arrays and inline tables.
// Multi-line strings and dates are rejected with a clear error.

type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
type TomlTable = { [key: string]: TomlValue };

class TomlCursor {
  pos = 0;
  readonly text: string;
  readonly file: string;
  constructor(text: string, file: string) {
    this.text = text;
    this.file = file;
  }

  fail(msg: string): never {
    const line = this.text.slice(0, this.pos).split("\n").length;
    throw new Error(`${this.file}:${line}: ${msg}`);
  }

  peek(): string {
    return this.text[this.pos] ?? "";
  }

  /** Skips spaces and tabs; with `newlines`, also newlines and comments. */
  skip(newlines: boolean): void {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r") this.pos++;
      else if (newlines && c === "\n") this.pos++;
      else if (newlines && c === "#") while (this.pos < this.text.length && this.peek() !== "\n") this.pos++;
      else return;
    }
  }

  key(): string {
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    const start = this.pos;
    while (/[A-Za-z0-9_-]/.test(this.peek())) this.pos++;
    if (start === this.pos) this.fail(`expected a key, got "${c}"`);
    return this.text.slice(start, this.pos);
  }

  dottedKey(): string[] {
    const parts = [this.key()];
    this.skip(false);
    while (this.peek() === ".") {
      this.pos++;
      this.skip(false);
      parts.push(this.key());
      this.skip(false);
    }
    return parts;
  }

  string(): string {
    const quote = this.peek();
    if (this.text.startsWith(quote.repeat(3), this.pos)) this.fail("multi-line strings are not supported");
    this.pos++;
    let out = "";
    for (;;) {
      const c = this.peek();
      if (c === "" || c === "\n") this.fail("unterminated string");
      this.pos++;
      if (c === quote) return out;
      if (c === "\\" && quote === '"') {
        const e = this.peek();
        this.pos++;
        const simple: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          n: "\n",
          t: "\t",
          r: "\r",
          b: "\b",
          f: "\f",
        };
        if (e in simple) out += simple[e];
        else if (e === "u" || e === "U") {
          const len = e === "u" ? 4 : 8;
          out += String.fromCodePoint(Number.parseInt(this.text.slice(this.pos, this.pos + len), 16));
          this.pos += len;
        } else this.fail(`bad escape \\${e}`);
      } else out += c;
    }
  }

  value(): TomlValue {
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    if (c === "[") return this.array();
    if (c === "{") return this.inlineTable();
    if (this.text.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    const match = /^[+-]?[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9_]+)?/.exec(this.text.slice(this.pos));
    if (match === null) this.fail(`unsupported value starting with "${c}"`);
    const raw = match[0];
    if (/^\d{4}-/.test(this.text.slice(this.pos))) this.fail("dates are not supported");
    this.pos += raw.length;
    return Number(raw.replaceAll("_", ""));
  }

  array(): TomlValue[] {
    this.pos++;
    const out: TomlValue[] = [];
    for (;;) {
      this.skip(true);
      if (this.peek() === "]") {
        this.pos++;
        return out;
      }
      out.push(this.value());
      this.skip(true);
      if (this.peek() === ",") this.pos++;
      else if (this.peek() !== "]") this.fail("expected , or ] in array");
    }
  }

  inlineTable(): TomlTable {
    this.pos++;
    const out: TomlTable = {};
    this.skip(false);
    if (this.peek() === "}") {
      this.pos++;
      return out;
    }
    for (;;) {
      this.skip(false);
      const path = this.dottedKey();
      if (this.peek() !== "=") this.fail("expected = in inline table");
      this.pos++;
      this.skip(false);
      assign(this, out, path, this.value());
      this.skip(false);
      if (this.peek() === ",") this.pos++;
      else if (this.peek() === "}") {
        this.pos++;
        return out;
      } else this.fail("expected , or } in inline table");
    }
  }
}

function isTable(v: TomlValue | undefined): v is TomlTable {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function descend(cur: TomlCursor, table: TomlTable, path: readonly string[]): TomlTable {
  let t = table;
  for (const part of path) {
    const next = t[part];
    if (next === undefined) {
      const created: TomlTable = {};
      t[part] = created;
      t = created;
    } else if (Array.isArray(next)) {
      const last = next[next.length - 1];
      if (!isTable(last)) cur.fail(`"${part}" is not a table`);
      t = last;
    } else if (isTable(next)) t = next;
    else cur.fail(`"${part}" is not a table`);
  }
  return t;
}

function assign(cur: TomlCursor, table: TomlTable, path: readonly string[], value: TomlValue): void {
  const parent = descend(cur, table, path.slice(0, -1));
  const last = path[path.length - 1] ?? cur.fail("empty key");
  if (last in parent) cur.fail(`duplicate key "${path.join(".")}"`);
  parent[last] = value;
}

function parseToml(text: string, file: string): TomlTable {
  const cur: TomlCursor = new TomlCursor(text, file);
  const doc: TomlTable = {};
  let current = doc;
  for (;;) {
    cur.skip(true);
    if (cur.pos >= text.length) return doc;
    if (cur.peek() === "[") {
      const arrayOfTables = text.startsWith("[[", cur.pos);
      cur.pos += arrayOfTables ? 2 : 1;
      cur.skip(false);
      const path = cur.dottedKey();
      if (!text.startsWith(arrayOfTables ? "]]" : "]", cur.pos)) cur.fail("unterminated table header");
      cur.pos += arrayOfTables ? 2 : 1;
      if (arrayOfTables) {
        const parent = descend(cur, doc, path.slice(0, -1));
        const name = path[path.length - 1] ?? cur.fail("empty table name");
        const list = parent[name] ?? [];
        if (!Array.isArray(list)) cur.fail(`"${path.join(".")}" is not an array of tables`);
        const created: TomlTable = {};
        list.push(created);
        parent[name] = list;
        current = created;
      } else current = descend(cur, doc, path);
    } else {
      const path = cur.dottedKey();
      if (cur.peek() !== "=") cur.fail("expected =");
      cur.pos++;
      cur.skip(false);
      assign(cur, current, path, cur.value());
    }
    cur.skip(false);
    if (cur.peek() === "#") cur.skip(true);
    else if (cur.peek() !== "\n" && cur.pos < text.length) cur.fail("expected end of line");
  }
}

// ---------------------------------------------------------------------------------------------
// models.dev resolution: provider models may inherit from models/<vendor>/<id>.toml via base_model.

function tomlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".toml")) out.push(join(entry.parentPath, entry.name));
  }
  return out.sort();
}

function idFor(dir: string, file: string): string {
  return relative(dir, file).split(sep).join("/").slice(0, -".toml".length);
}

function mergeDeep(base: TomlTable, over: TomlTable): TomlTable {
  const out: TomlTable = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = isTable(b) && isTable(v) ? mergeDeep(b, v) : v;
  }
  return out;
}

function omitPath(target: TomlTable, path: string): void {
  const parts = path.split(".");
  let t: TomlTable = target;
  for (const part of parts.slice(0, -1)) {
    const next = t[part];
    if (!isTable(next)) return;
    t = next;
  }
  delete t[parts[parts.length - 1] ?? ""];
}

const NOT_INHERITED = ["id", "benchmarks", "license", "links", "weights"];

function readCheckout(dir: string, providers: readonly string[]): { api: TomlTable; source: string } {
  const baseDir = join(dir, "models");
  const bases = new Map<string, TomlTable>();
  for (const file of tomlFiles(baseDir))
    bases.set(idFor(baseDir, file), parseToml(readFileSync(file, "utf8"), file));

  const api: TomlTable = {};
  for (const providerId of providers) {
    const providerFile = join(dir, "providers", providerId, "provider.toml");
    if (!existsSync(providerFile)) throw new Error(`no provider.toml for "${providerId}" in ${dir}`);
    const provider = parseToml(readFileSync(providerFile, "utf8"), providerFile);
    const modelsDir = join(dir, "providers", providerId, "models");
    const models: TomlTable = {};
    for (const file of tomlFiles(modelsDir)) {
      const id = idFor(modelsDir, file);
      let model = parseToml(readFileSync(file, "utf8"), file);
      const baseRef = model.base_model;
      if (typeof baseRef === "string") {
        const base = bases.get(baseRef);
        if (base === undefined) throw new Error(`${file}: unknown base_model "${baseRef}"`);
        const inherited = Object.fromEntries(
          Object.entries(base).filter(([k]) => !NOT_INHERITED.includes(k)),
        );
        const { base_model: _b, base_model_omit: omit, ...own } = model;
        model = mergeDeep(inherited, own);
        if (Array.isArray(omit)) for (const p of omit) if (typeof p === "string") omitPath(model, p);
      }
      models[id] = { ...model, id };
    }
    api[providerId] = { ...provider, id: providerId, models };
  }
  return { api, source: `models.dev checkout @ ${checkoutCommit(dir)}` };
}

/** Reads the checkout's HEAD commit from .git without running git. */
function checkoutCommit(dir: string): string {
  try {
    const head = readFileSync(join(dir, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    const loose = join(dir, ".git", ref);
    if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
    const packed = readFileSync(join(dir, ".git", "packed-refs"), "utf8");
    const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
    return line?.split(" ")[0] ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------------------------

const selection = DEFAULT_SNAPSHOT_SELECTION;
let api: unknown;
let source: string;
if (!values.fetch && existsSync(join(values.refs, "providers"))) {
  console.log(`Reading models.dev checkout at ${values.refs}`);
  ({ api, source } = readCheckout(values.refs, selection.providers));
} else {
  console.log(`Fetching ${values.url}`);
  const res = await fetch(values.url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${values.url}: HTTP ${res.status}`);
  api = await res.json();
  source = values.url;
}

const built = buildModelsSnapshot(api, { source, generatedAt: new Date().toISOString(), selection });
if (!built.ok) {
  console.error(
    `Snapshot failed: ${built.error.message}${built.error.path ? ` at ${built.error.path}` : ""}`,
  );
  process.exit(1);
}
writeFileSync(values.out, `${JSON.stringify(built.value, null, 2)}\n`);

const biome = join(root, "node_modules", ".bin", "biome");
if (existsSync(biome)) spawnSync(biome, ["format", "--write", values.out], { stdio: "ignore" });

const counts = Object.entries(built.value.providers).map(
  ([id, p]) => `${id} ${Object.keys(p.models).length}`,
);
const bytes = readFileSync(values.out).byteLength;
console.log(`Wrote ${relative(root, values.out)} (${(bytes / 1024).toFixed(1)} KB): ${counts.join(", ")}`);
