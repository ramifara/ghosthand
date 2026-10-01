// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// A tiny allowlist sanitizer for the contenteditable bio, plus readers the oracle uses.
// Keeps p, br, strong and em (b -> strong, i -> em, div -> p); drops every attribute and other tag.
// Browser-safe, no DOM needed, so the server and oracles run it too.

export const RICH_TEXT_MAX = 2000;

const RENAME: Record<string, string> = {
  p: "p",
  div: "p",
  br: "br",
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
};
const DROP_CONTENT = new Set(["script", "style", "template", "iframe", "object", "noscript"]);

type Token = { kind: "text"; text: string } | { kind: "open" | "close"; tag: string };

function decode(text: string): string {
  return text
    .replace(/&nbsp;| /g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encode(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let dropDepth = 0;
  let dropTag = "";
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|<!--[\s\S]*?-->|[^<]+|</g)) {
    const [whole, slash, rawTag] = m;
    if (whole.startsWith("<!--")) continue;
    if (rawTag === undefined) {
      if (dropDepth === 0) tokens.push({ kind: "text", text: decode(whole) });
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (DROP_CONTENT.has(tag)) {
      if (!slash && dropDepth === 0) dropTag = tag;
      if (tag === dropTag) dropDepth += slash ? -1 : 1;
      if (dropDepth < 0) dropDepth = 0;
      continue;
    }
    if (dropDepth > 0) continue;
    const mapped = RENAME[tag];
    if (!mapped) continue;
    tokens.push({ kind: slash ? "close" : "open", tag: mapped });
  }
  return tokens;
}

/** Returns well-formed, attribute-free HTML using only p, br, strong and em. */
export function sanitizeRichText(html: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  for (const t of tokenize(html)) {
    if (t.kind === "text") {
      out.push(encode(t.text.replace(/\s+/g, " ")));
    } else if (t.tag === "br") {
      if (t.kind === "open") out.push("<br>");
    } else if (t.kind === "open") {
      // Paragraphs don't nest: a new one closes everything still open.
      if (t.tag === "p") while (stack.length > 0) out.push(`</${stack.pop()}>`);
      stack.push(t.tag);
      out.push(`<${t.tag}>`);
    } else if (stack.includes(t.tag)) {
      for (;;) {
        const top = stack.pop();
        out.push(`</${top}>`);
        if (top === t.tag) break;
      }
    }
  }
  while (stack.length > 0) out.push(`</${stack.pop()}>`);
  let result = out.join("");
  // Drop empty inline wrappers; keep empty paragraphs out too.
  for (let prev = ""; prev !== result; ) {
    prev = result;
    result = result.replace(/<(strong|em)>\s*<\/\1>/g, "").replace(/<p>\s*<\/p>/g, "");
  }
  return result.trim();
}

/** The visible text, whitespace collapsed. */
export function richTextPlain(html: string): string {
  return decode(
    html
      .replace(/<br>/g, " ")
      .replace(/<\/p>\s*<p>/g, " ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Text runs wrapped in `tag` (e.g. "strong"), trimmed, in document order. Adjacent runs merge. */
export function richTextRuns(html: string, tag: "strong" | "em"): string[] {
  const runs: string[] = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text) runs.push(text);
    current = "";
  };
  for (const t of tokenize(html)) {
    if (t.kind === "text") {
      if (depth > 0) current += t.text;
      else if (t.text.trim()) flush();
    } else if (t.tag === tag) {
      depth = Math.max(0, depth + (t.kind === "open" ? 1 : -1));
    } else if (t.tag === "p" || t.tag === "br") {
      flush();
    }
  }
  flush();
  return runs;
}
