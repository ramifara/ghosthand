// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Origin allowlist + blocklist for the agent's browser. The blocklist always wins; the testbed control
// API is always blocked. Top-level navigations must stay on the allowlist; subresources and frames may
// load from other origins unless blocked (sites need CDNs), or unless `strictSubresources` is set.

export interface OriginPattern {
  /** "http:" / "https:" / "ws:" ..., or undefined for any scheme. */
  scheme?: string;
  /** Exact host, or "*.example.com" for the domain and its subdomains. */
  host: string;
  /** Port as a string; undefined means any port (or the scheme's default port when a scheme is given). */
  port?: string;
}

/** The testbed control API: never reachable from the agent's browser. */
export const ALWAYS_BLOCKED = ["127.0.0.1:4401", "localhost:4401", "[::1]:4401"];

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" };

/** Parses "https://app.test", "app.test:8080", "*.example.com" or a full URL. Returns undefined when invalid. */
export function parseOriginPattern(input: string): OriginPattern | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    const wildcard = s.includes("://*.");
    try {
      const u = new URL(wildcard ? s.replace("://*.", "://wildcard-placeholder.") : s);
      const host = wildcard ? u.hostname.replace(/^wildcard-placeholder\./, "*.") : u.hostname;
      const port = u.port || DEFAULT_PORT[u.protocol];
      return { scheme: u.protocol, host: host.toLowerCase(), ...(port ? { port } : {}) };
    } catch {
      return undefined;
    }
  }
  const m = /^(\*\.)?([a-z0-9.-]+|\[[0-9a-f:]+\])(?::(\d+))?$/i.exec(s);
  if (!m?.[2]) return undefined;
  return { host: `${m[1] ?? ""}${m[2]}`.toLowerCase(), ...(m[3] ? { port: m[3] } : {}) };
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return pattern === host;
}

export function matchesPattern(p: OriginPattern, url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!hostMatches(p.host, host)) return false;
  const port = url.port || DEFAULT_PORT[url.protocol] || "";
  if (p.scheme !== undefined) {
    const same =
      p.scheme === url.protocol ||
      (p.scheme === "http:" && url.protocol === "ws:") ||
      (p.scheme === "https:" && url.protocol === "wss:");
    if (!same) return false;
  }
  return p.port === undefined || p.port === port;
}

/** Second-level labels under country TLDs that act as public suffixes (co.uk, com.au, ...). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or", "go"]);

/**
 * Site-wide pattern for a start URL ("https://facebook.com" → "https://*.facebook.com"), so the site's own
 * redirects (www., accounts., m.) stay allowed. IPs and single-label hosts (localhost) stay exact.
 */
export function siteOf(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) return undefined;
  const labels = host.split(".");
  const n =
    labels.length >= 3 && SECOND_LEVEL.has(labels.at(-2) ?? "") && (labels.at(-1) ?? "").length === 2 ? 3 : 2;
  return `${u.protocol}//*.${labels.slice(-n).join(".")}`;
}

export type GuardDecision = { allowed: true } | { allowed: false; reason: "blocklist" | "not_allowlisted" };

export interface OriginGuardOptions {
  allow?: readonly string[];
  block?: readonly string[];
  /** Also block subresource requests to origins outside the allowlist. */
  strictSubresources?: boolean;
}

const LOCAL_SCHEMES = new Set(["about:", "data:", "blob:", "javascript:"]);

export class OriginGuard {
  readonly #allow: OriginPattern[] = [];
  readonly #block: OriginPattern[] = [];
  readonly #strict: boolean;

  constructor(opts: OriginGuardOptions = {}) {
    for (const a of opts.allow ?? []) this.allow(a);
    for (const b of [...ALWAYS_BLOCKED, ...(opts.block ?? [])]) {
      const p = parseOriginPattern(b);
      if (p) this.#block.push(p);
    }
    this.#strict = opts.strictSubresources ?? false;
  }

  /** Adds an origin (or URL) to the allowlist. Returns false when it cannot be parsed. */
  allow(origin: string): boolean {
    const p = parseOriginPattern(origin);
    if (!p) return false;
    this.#allow.push(p);
    return true;
  }

  get hasAllowlist(): boolean {
    return this.#allow.length > 0;
  }

  isBlocked(url: string): boolean {
    const u = safeUrl(url);
    return u !== undefined && this.#block.some((p) => matchesPattern(p, u));
  }

  /** Allowed as a top-level page: not blocked, and on the allowlist (an empty allowlist allows everything). */
  check(url: string): GuardDecision {
    const u = safeUrl(url);
    if (u === undefined) return { allowed: false, reason: "not_allowlisted" };
    if (LOCAL_SCHEMES.has(u.protocol)) return { allowed: true };
    if (this.#block.some((p) => matchesPattern(p, u))) return { allowed: false, reason: "blocklist" };
    if (this.#allow.length === 0) return { allowed: true };
    return this.#allow.some((p) => matchesPattern(p, u))
      ? { allowed: true }
      : { allowed: false, reason: "not_allowlisted" };
  }

  /** Decision for a network request. */
  checkRequest(url: string, topLevelNavigation: boolean): GuardDecision {
    if (topLevelNavigation || this.#strict) return this.check(url);
    return this.isBlocked(url) ? { allowed: false, reason: "blocklist" } : { allowed: true };
  }
}

function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
