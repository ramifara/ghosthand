// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { randomUUID } from "node:crypto";
import { SecretsRegistry } from "@ghosthand/core";
import type { BrowserNetworkInput, ComputerError, Result } from "@ghosthand/protocol";
import { BrowserNetwork, err, ok } from "@ghosthand/protocol";
import { z } from "zod";
import { OriginGuard } from "../web/origin-guard.ts";

export interface PreparedBrowserNetwork {
  proxy?: { server: string; username?: string; password?: string };
  userAgent?: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
}

const Cookie = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(16384),
  domain: z.string().min(1).max(253),
  path: z.string().startsWith("/").max(2048).default("/"),
  expires: z.number().finite().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});
const Envelope = z.object({ status: z.enum(["ok", "error"]) });
const Solution = z.object({
  status: z.literal("ok"),
  solution: z.object({
    url: z.url(),
    status: z.number().int().min(200).max(399),
    userAgent: z
      .string()
      .min(1)
      .max(1024)
      .refine((value) => !/[\r\n]/.test(value)),
    cookies: z.array(Cookie).max(1000),
  }),
});
const fail = (message: string): Result<never, ComputerError> => err({ kind: "launch_failed", message });

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("missing response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024 * 1024) throw new Error("response too large");
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** External preparation only. Disabled settings never contact the service; no requests are retried. */
export async function prepareBrowserNetwork(opts: {
  network?: BrowserNetworkInput;
  secrets?: SecretsRegistry;
  startUrl?: string;
  allowOrigins?: readonly string[];
  blockOrigins?: readonly string[];
  fetch?: typeof globalThis.fetch;
}): Promise<Result<PreparedBrowserNetwork, ComputerError>> {
  const parsed = BrowserNetwork.safeParse(opts.network ?? {});
  if (!parsed.success) return fail(`browser network settings: ${parsed.error.issues[0]?.message}`);
  const { proxy, flaresolverr: solver } = parsed.data;
  const secrets = opts.secrets ?? new SecretsRegistry();
  const prepared: PreparedBrowserNetwork = { cookies: [] };
  if (proxy.enabled && proxy.server) {
    const username = proxy.usernameSecretRef ? secrets.resolve(proxy.usernameSecretRef) : undefined;
    const password = proxy.passwordSecretRef ? secrets.resolve(proxy.passwordSecretRef) : undefined;
    if (proxy.usernameSecretRef && (!username || !password))
      return fail("proxy credentials are missing; configure both named credentials");
    prepared.proxy = {
      server: proxy.server,
      ...(username !== undefined ? { username } : {}),
      ...(password !== undefined ? { password } : {}),
    };
  }
  if (!solver.enabled) return ok(prepared);
  let target: URL;
  try {
    target = new URL(opts.startUrl ?? "");
  } catch {
    return fail("FlareSolverr requires a starting HTTP(S) URL");
  }
  const enabledOrigins = new Set(solver.origins.map((value) => new URL(value).origin));
  if (!enabledOrigins.has(target.origin)) return ok(prepared);
  const guard = new OriginGuard({
    allow: [target.origin, ...(opts.allowOrigins ?? [])],
    block: opts.blockOrigins ?? [],
  });
  if (!["http:", "https:"].includes(target.protocol) || !guard.check(target.href).allowed)
    return fail("FlareSolverr starting origin is blocked");
  const bearer = solver.bearerSecretRef ? secrets.resolve(solver.bearerSecretRef) : undefined;
  if (solver.bearerSecretRef && !bearer) return fail("FlareSolverr bearer credential is missing");
  const endpoint = new URL(solver.endpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "").replace(/\/v1$/, "")}/v1`;
  const request = async (
    body: Record<string, unknown>,
    timeoutMs = solver.timeoutMs,
  ): Promise<Result<unknown, ComputerError>> => {
    try {
      const response = await (opts.fetch ?? globalThis.fetch)(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs + 2000),
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return fail(`FlareSolverr returned HTTP ${response.status}`);
      }
      const json = await readJson(response);
      const envelope = Envelope.safeParse(json);
      if (!envelope.success) return fail("FlareSolverr returned an invalid response");
      if (envelope.data.status === "error")
        return fail("FlareSolverr could not prepare the page; disable it to use human takeover");
      return ok(json);
    } catch {
      // Service messages and transport exceptions can include credentials, URLs or cookie values.
      return fail("FlareSolverr request failed or timed out; check the endpoint and timeout");
    }
  };
  const upstream = prepared.proxy
    ? {
        url: prepared.proxy.server,
        ...(prepared.proxy.username !== undefined ? { username: prepared.proxy.username } : {}),
        ...(prepared.proxy.password !== undefined ? { password: prepared.proxy.password } : {}),
      }
    : undefined;
  const session = upstream?.username !== undefined ? `ghosthand-${randomUUID()}` : undefined;
  let result: Result<PreparedBrowserNetwork, ComputerError>;
  try {
    let creationError: ComputerError | undefined;
    if (session) {
      const created = await request({
        cmd: "sessions.create",
        session,
        proxy: upstream,
        maxTimeout: solver.timeoutMs,
      });
      if (!created.ok) creationError = created.error;
      else if (!z.object({ session: z.literal(session) }).safeParse(created.value).success)
        creationError = {
          kind: "launch_failed",
          message: "FlareSolverr did not return the task-owned session",
        };
    }
    const resolved = creationError
      ? err(creationError)
      : await request({
          cmd: "request.get",
          url: target.href,
          maxTimeout: solver.timeoutMs,
          returnOnlyCookies: true,
          ...(session ? { session } : upstream ? { proxy: upstream } : {}),
        });
    if (!resolved.ok) result = resolved;
    else {
      const solution = Solution.safeParse(resolved.value);
      if (!solution.success)
        result = fail("FlareSolverr returned invalid session data or an unsuccessful page");
      else {
        const value = solution.data.solution;
        const finalUrl = new URL(value.url);
        if (!enabledOrigins.has(finalUrl.origin) || !guard.check(finalUrl.href).allowed)
          result = fail("FlareSolverr redirected outside the configured origins");
        else {
          prepared.userAgent = value.userAgent;
          prepared.cookies = value.cookies
            .filter((cookie) => {
              const domain = cookie.domain.replace(/^\./, "").toLowerCase();
              return target.hostname === domain || target.hostname.endsWith(`.${domain}`);
            })
            .map((cookie) => ({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              ...(cookie.expires !== undefined ? { expires: cookie.expires < 0 ? -1 : cookie.expires } : {}),
              ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
              ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
              ...(cookie.sameSite !== undefined ? { sameSite: cookie.sameSite } : {}),
            }));
          result = ok(prepared);
        }
      }
    }
  } finally {
    // The random id is ours even if creation timed out after the service started its browser.
    if (session) {
      const destroyed = await request({ cmd: "sessions.destroy", session }, 5000);
      if (!destroyed.ok)
        result = fail("FlareSolverr session cleanup failed; check the service for the task-owned session");
    }
  }
  return result;
}
