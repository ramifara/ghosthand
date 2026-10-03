// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Some providers answer a JSON-schema request with prose around the object, or a fenced block (the
// ChatGPT plan did, so every writer hand-off failed with "No object generated"). Before giving up, the
// first balanced {...} in the text is parsed and checked against the schema.
import type { z } from "zod";

/** The first balanced JSON object in `text`, parsed, or undefined. Fences and prose around it are ignored. */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** The object in `text` that satisfies `schema`, or undefined. */
export function salvageObject<T>(text: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!text) return undefined;
  const candidate = firstJsonObject(text);
  if (candidate === undefined) return undefined;
  const parsed = schema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
