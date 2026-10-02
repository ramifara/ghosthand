// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// What each renderer command does in main. Settings, secrets, ChatGPT sign-in and external links stay
// in main; run, history, task, model and profile commands go to the engine host. Credentials are
// attached here (main) and never travel back to the renderer.

import {
  createModelCatalog,
  DEFAULT_ROLE_BINDINGS,
  parseRoleBindings,
  validateBindings,
} from "@ghosthand/models";
import {
  type HostCommandName,
  type HostCredentials,
  type IpcCommandName,
  IpcCommands,
  type IpcOutput,
  type IpcResponse,
  type RoleBindingsInput,
} from "@ghosthand/protocol";
import type { ChatGptAuth } from "./chatgpt/chatgpt-auth.ts";
import type { EngineHostClient } from "./engine-host-client.ts";
import { envFileKeyNames } from "./env-file-names.ts";
import { isAllowedExternalUrl } from "./external-links.ts";
import type { IpcHandlers } from "./ipc-router.ts";
import type { SecretStore } from "./secret-store.ts";
import type { SettingsStore } from "./settings-store.ts";

export interface MainHandlerDeps {
  settings: SettingsStore;
  secrets: SecretStore;
  host: Pick<EngineHostClient, "request">;
  chatgpt: ChatGptAuth;
  openExternal: (url: string) => Promise<void>;
  app: { version: string; platform: string; electron: string };
  onRunStarted?: (runId: string) => void;
}

const TIMEOUTS: Partial<Record<HostCommandName, number>> = {
  "runs.start": 120_000,
  "doctor.run": 60_000,
  "profiles.import": 300_000,
  "models.list": 30_000,
};

const ok = <T>(value: T): IpcResponse<T> => ({ ok: true, value });
const fail = <T>(kind: "invalid_input" | "unavailable" | "engine", message: string): IpcResponse<T> => ({
  ok: false,
  error: { kind, message },
});

export function createMainHandlers(deps: MainHandlerDeps): IpcHandlers {
  const credentials = async (): Promise<HostCredentials> => {
    const token = await deps.chatgpt.accessToken();
    return { secrets: deps.secrets.entries(), ...(token ? { chatgptAccessToken: token } : {}) };
  };

  /** Forwards to the host and validates the answer against the command's output schema. */
  async function forward<K extends IpcCommandName & HostCommandName>(
    command: K,
    input: unknown,
    opts: { withSettings?: boolean; withCredentials?: boolean } = {},
  ): Promise<IpcResponse<IpcOutput<K>>> {
    const r = await deps.host.request(command, input, {
      ...(opts.withSettings ? { settings: deps.settings.get() } : {}),
      ...(opts.withCredentials ? { credentials: await credentials() } : {}),
      ...(TIMEOUTS[command] ? { timeoutMs: TIMEOUTS[command] } : {}),
    });
    if (!r.ok) return r;
    const parsed = IpcCommands[command].output.safeParse(r.value);
    if (!parsed.success) return fail("engine", `${command}: unexpected engine response`);
    return ok(parsed.data as IpcOutput<K>);
  }

  const catalog = createModelCatalog();

  const effectiveBindings = (): RoleBindingsInput => {
    const saved = deps.settings.get().roleBindings;
    return Object.keys(saved).length > 0 ? saved : (DEFAULT_ROLE_BINDINGS as RoleBindingsInput);
  };

  return {
    "app.info": async () => {
      const runsDir = await deps.host.request("app.runsDir", {});
      return ok({
        ...deps.app,
        secrets: deps.secrets.status(),
        runsDir: runsDir.ok && typeof runsDir.value === "string" ? runsDir.value : "",
      });
    },

    "runs.start": async (input) => {
      const settings = deps.settings.get();
      if (input.decision === "heuristic" && !settings.devPlumbingMode) {
        return fail("invalid_input", "plumbing mode is off (Settings → Developer)");
      }
      const r = await forward("runs.start", input, { withSettings: true, withCredentials: true });
      if (r.ok) deps.onRunStarted?.(r.value.runId);
      return r;
    },
    "runs.stop": (input) => forward("runs.stop", input),
    "runs.approve": (input) => forward("runs.approve", input),
    "runs.takeover": (input) => forward("runs.takeover", input),
    "runs.resume": (input) => forward("runs.resume", input),
    "runs.active": (input) => forward("runs.active", input),
    "runs.list": (input) => forward("runs.list", input),
    "runs.get": (input) => forward("runs.get", input),
    "runs.events": (input) => forward("runs.events", input),
    "runs.screenshot": (input) => forward("runs.screenshot", input),
    "tasks.list": (input) => forward("tasks.list", input),
    "doctor.run": (input) => forward("doctor.run", input, { withCredentials: true }),
    "models.list": (input) => forward("models.list", input, { withSettings: true, withCredentials: true }),
    "profiles.list": (input) => forward("profiles.list", input),
    "profiles.create": (input) => forward("profiles.create", input),
    "profiles.import": (input) => forward("profiles.import", input),

    "settings.get": async () => ok(deps.settings.get()),
    "settings.set": async (patch) => {
      const next = deps.settings.patch(patch);
      if (patch.persistWithoutKeyring !== undefined)
        deps.secrets.setPersistWithoutKeyring(next.persistWithoutKeyring);
      if (patch.chatgptSignIn === false) deps.chatgpt.cancel();
      return ok(next);
    },

    "secrets.list": async () => {
      const status = deps.secrets.status();
      return ok({ ...status, names: [...new Set([...status.names, ...envFileKeyNames()])].sort() });
    },
    "secrets.set": async ({ name, value }) => {
      const r = deps.secrets.set(name, value);
      return r.ok ? ok(deps.secrets.status()) : fail("unavailable", r.error.message);
    },
    "secrets.delete": async ({ name }) => {
      const r = deps.secrets.delete(name);
      return r.ok ? ok(deps.secrets.status()) : fail("unavailable", r.error.message);
    },

    "roles.get": async () => ok(effectiveBindings()),
    "roles.set": async (input) => {
      const parsed = parseRoleBindings(input);
      if (!parsed.ok) return fail("invalid_input", parsed.error.message);
      if (catalog.ok) {
        const valid = validateBindings(catalog.value, parsed.value);
        if (!valid.ok) return fail("invalid_input", valid.error.map((e) => e.message).join("; "));
      }
      deps.settings.patch({ roleBindings: input });
      return ok(effectiveBindings());
    },

    "chatgpt.status": async () => ok(deps.chatgpt.status()),
    "chatgpt.signIn": async () => ok(await deps.chatgpt.signIn()),
    "chatgpt.completeManual": async ({ url }) => ok(deps.chatgpt.completeManual(url)),
    "chatgpt.cancel": async () => ok(deps.chatgpt.cancel()),
    "chatgpt.signOut": async () => ok(deps.chatgpt.signOut()),

    "shell.openExternal": async ({ url }) => {
      if (!isAllowedExternalUrl(url)) return fail("invalid_input", "that link is not on the allow-list");
      await deps.openExternal(url);
      return ok(null);
    },
  };
}
