// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Content-Security-Policy for the renderer. Production is strict: scripts only from the app bundle,
// no eval, no network beyond the app origin. Screencast frames and screenshots arrive as data: URLs.
// Dev relaxes script/connect just enough for Vite's HMR client on loopback.

export function buildCsp(opts: { dev: boolean; devOrigin?: string | undefined }): string {
  const dev = opts.dev && opts.devOrigin !== undefined;
  const ws = dev ? opts.devOrigin?.replace(/^http/, "ws") : undefined;
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", dev ? ["'self'", "'unsafe-inline'", opts.devOrigin ?? ""] : ["'self'"]],
    // Radix primitives inject small <style> tags (scroll lock), so inline styles are allowed.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", dev ? ["'self'", opts.devOrigin ?? "", ws ?? ""] : ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["worker-src", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.filter(Boolean).join(" ")}`).join("; ");
}
