// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { z } from "zod";

const SecretRef = z
  .string()
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "expected a credential name");
const serverUrl = (protocols: string[]) =>
  z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          protocols.includes(url.protocol) &&
          url.hostname.length > 0 &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, "expected a server URL without credentials, query or fragment");
const HttpServer = serverUrl(["http:", "https:"]);
const ProxyServer = serverUrl(["http:", "https:", "socks4:", "socks5:"]).refine((value) => {
  try {
    const url = new URL(value);
    return !url.pathname || url.pathname === "/";
  } catch {
    return false;
  }
}, "proxy URL cannot have a path");
const Origin = HttpServer.refine((value) => {
  try {
    return new URL(value).pathname === "/";
  } catch {
    return false;
  }
}, "expected an origin without a path");

export const BrowserNetwork = z
  .object({
    proxy: z
      .object({
        enabled: z.boolean().default(false),
        server: ProxyServer.optional(),
        usernameSecretRef: SecretRef.optional(),
        passwordSecretRef: SecretRef.optional(),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.enabled && !value.server)
          ctx.addIssue({
            code: "custom",
            path: ["server"],
            message: "proxy server is required when enabled",
          });
        if (Boolean(value.usernameSecretRef) !== Boolean(value.passwordSecretRef))
          ctx.addIssue({ code: "custom", message: "provide both proxy credential names" });
        if (value.server && /^socks[45]:/i.test(value.server) && value.usernameSecretRef)
          ctx.addIssue({
            code: "custom",
            message: "SOCKS proxy authentication is unsupported; use an authenticated HTTP proxy",
          });
      })
      .prefault({}),
    flaresolverr: z
      .object({
        enabled: z.boolean().default(false),
        endpoint: HttpServer.default("http://127.0.0.1:8191"),
        bearerSecretRef: SecretRef.optional(),
        origins: z.array(Origin).max(100).default([]),
        timeoutMs: z.number().int().min(1000).max(120000).default(60000),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.enabled && value.origins.length === 0)
          ctx.addIssue({
            code: "custom",
            path: ["origins"],
            message: "add at least one FlareSolverr origin",
          });
      })
      .prefault({}),
  })
  .strict();
export type BrowserNetwork = z.infer<typeof BrowserNetwork>;
export type BrowserNetworkInput = z.input<typeof BrowserNetwork>;
