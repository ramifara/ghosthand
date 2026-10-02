// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { BrowserNetwork } from "@ghosthand/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input, TextArea } from "../../components/ui/field.tsx";
import { SwitchField } from "../../components/ui/switch.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";
import { useUiStore } from "../../stores/ui-store.ts";

export function BrowserNetworkSection() {
  const qc = useQueryClient();
  const id = useId();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const cached = useUiStore((state) => state.forms.browserNetwork);
  const stored = settings.data?.browserNetwork;
  const draft = cached ?? {
    proxy: {
      enabled: stored?.proxy.enabled ?? false,
      server: stored?.proxy.server ?? "",
      username: stored?.proxy.usernameSecretRef ?? "",
      password: stored?.proxy.passwordSecretRef ?? "",
    },
    solver: {
      enabled: stored?.flaresolverr.enabled ?? false,
      endpoint: stored?.flaresolverr.endpoint ?? "http://127.0.0.1:8191",
      origins: stored?.flaresolverr.origins.join("\n") ?? "",
      bearer: stored?.flaresolverr.bearerSecretRef ?? "",
      seconds: String((stored?.flaresolverr.timeoutMs ?? 60000) / 1000),
    },
  };
  const { proxy, solver } = draft;
  const setProxy = (proxy: typeof draft.proxy) =>
    useUiStore.getState().setForm("browserNetwork", { ...draft, proxy });
  const setSolver = (solver: typeof draft.solver) =>
    useUiStore.getState().setForm("browserNetwork", { ...draft, solver });
  const save = useMutation({
    mutationFn: () => {
      const parsed = BrowserNetwork.safeParse({
        proxy: {
          enabled: proxy.enabled,
          ...(proxy.server.trim() ? { server: proxy.server.trim() } : {}),
          ...(proxy.username.trim() ? { usernameSecretRef: proxy.username.trim() } : {}),
          ...(proxy.password.trim() ? { passwordSecretRef: proxy.password.trim() } : {}),
        },
        flaresolverr: {
          enabled: solver.enabled,
          endpoint: solver.endpoint.trim(),
          origins: solver.origins.split(/[\s,]+/).filter(Boolean),
          timeoutMs: Number(solver.seconds) * 1000,
          ...(solver.bearer.trim() ? { bearerSecretRef: solver.bearer.trim() } : {}),
        },
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid network settings");
      return call("settings.set", { browserNetwork: parsed.data });
    },
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      useUiStore.getState().clearForm("browserNetwork");
    },
  });
  if (!settings.data) return null;
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="mt-6 grid max-w-2xl gap-4 border-t border-line pt-5"
    >
      <div>
        <h3 id={`${id}-heading`} className="label">
          Proxy and external FlareSolverr
        </h3>
        <p className="mt-1 text-xs text-muted">
          Supply your own services. GhostHand does not install or start them. Credential fields take names
          from Setup → Providers, such as PROXY_PASSWORD.
        </p>
      </div>
      <SwitchField
        label="Use a browser proxy"
        hint="Routes the browser through an HTTP or SOCKS proxy. Credentials are supported for HTTP proxies."
        checked={proxy.enabled}
        onChange={(enabled) => setProxy({ ...proxy, enabled })}
      />
      <Field label="Proxy server" htmlFor={`${id}-proxy`} hint="Do not include passwords in the URL.">
        <Input
          id={`${id}-proxy`}
          placeholder="http://127.0.0.1:8080"
          value={proxy.server}
          onChange={(e) => setProxy({ ...proxy, server: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Proxy username credential" htmlFor={`${id}-user`}>
          <Input
            id={`${id}-user`}
            placeholder="PROXY_USERNAME"
            value={proxy.username}
            onChange={(e) => setProxy({ ...proxy, username: e.target.value })}
          />
        </Field>
        <Field label="Proxy password credential" htmlFor={`${id}-password`}>
          <Input
            id={`${id}-password`}
            placeholder="PROXY_PASSWORD"
            value={proxy.password}
            onChange={(e) => setProxy({ ...proxy, password: e.target.value })}
          />
        </Field>
      </div>
      <SwitchField
        label="Prepare sessions with FlareSolverr"
        hint="Prepares the starting page once for the listed origins. Uses its cookies and user agent; clearance can still fail."
        checked={solver.enabled}
        onChange={(enabled) => setSolver({ ...solver, enabled })}
      />
      <Field label="FlareSolverr endpoint" htmlFor={`${id}-endpoint`}>
        <Input
          id={`${id}-endpoint`}
          value={solver.endpoint}
          onChange={(e) => setSolver({ ...solver, endpoint: e.target.value })}
        />
      </Field>
      <Field
        label="FlareSolverr origins"
        htmlFor={`${id}-origins`}
        hint="One origin per line. Only listed starting origins use the service."
      >
        <TextArea
          id={`${id}-origins`}
          rows={3}
          placeholder="https://app.example.com"
          value={solver.origins}
          onChange={(e) => setSolver({ ...solver, origins: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Service bearer credential"
          htmlFor={`${id}-bearer`}
          hint="Optional, for an authenticated gateway."
        >
          <Input
            id={`${id}-bearer`}
            placeholder="FLARESOLVERR_TOKEN"
            value={solver.bearer}
            onChange={(e) => setSolver({ ...solver, bearer: e.target.value })}
          />
        </Field>
        <Field label="Preparation timeout in seconds" htmlFor={`${id}-timeout`}>
          <Input
            id={`${id}-timeout`}
            type="number"
            min={1}
            max={120}
            value={solver.seconds}
            onChange={(e) => setSolver({ ...solver, seconds: e.target.value })}
          />
        </Field>
      </div>
      <p className="text-xs text-muted">
        When both are enabled, FlareSolverr uses the same upstream proxy. Keep the external service's browser
        and network settings consistent with GhostHand.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save proxy and FlareSolverr
        </Button>
        <Button
          aria-label="Reset proxy and FlareSolverr fields"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            useUiStore.getState().clearForm("browserNetwork");
            save.reset();
          }}
        >
          Reset fields
        </Button>
        {save.error ? (
          <span role="alert" className="text-danger">
            {errorMessage(save.error)}
          </span>
        ) : null}
        {save.isSuccess ? (
          <span role="status" className="text-muted">
            Saved
          </span>
        ) : null}
      </div>
    </section>
  );
}
