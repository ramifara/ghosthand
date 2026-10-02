// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { BrowserBehavior } from "@ghosthand/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input } from "../../components/ui/field.tsx";
import { SwitchField } from "../../components/ui/switch.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";
import { BrowserBehaviorDraft, useUiStore } from "../../stores/ui-store.ts";

export function BrowserBehaviorSection() {
  const qc = useQueryClient();
  const heading = useId();
  const localeId = useId();
  const timezoneId = useId();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const cached = useUiStore((state) => state.forms.browserBehavior);
  const draft = cached ?? BrowserBehaviorDraft.parse(settings.data?.browserBehavior ?? {});
  const setDraft = (value: typeof draft) => useUiStore.getState().setForm("browserBehavior", value);
  const locale = draft.locale;
  const timezone = draft.timezoneId;
  const save = useMutation({
    mutationFn: () => {
      const { locale: _locale, timezoneId: _timezone, ...behavior } = draft;
      const browserBehavior = BrowserBehavior.parse({
        ...behavior,
        ...(locale.trim() ? { locale: locale.trim() } : {}),
        ...(timezone.trim() ? { timezoneId: timezone.trim() } : {}),
      });
      return call("settings.set", { browserBehavior });
    },
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      useUiStore.getState().clearForm("browserBehavior");
    },
  });
  if (!settings.data) return null;
  return (
    <section aria-labelledby={heading} className="grid max-w-2xl gap-4">
      <div>
        <h3 id={heading} className="label">
          Web browser behavior
        </h3>
        <p className="mt-1 text-xs text-muted">
          Uses the selected profile and the browser's real fonts, graphics and user agent. These options apply
          to future web runs. Human verification still needs takeover.
        </p>
      </div>
      <SwitchField
        label="Reduce automation markers"
        hint="Best effort. Some sites can still recognize automation."
        checked={draft.reduceAutomationMarkers}
        onChange={(reduceAutomationMarkers) => setDraft({ ...draft, reduceAutomationMarkers })}
      />
      <SwitchField
        label="Human-like input"
        hint="Varies typing, mouse movement and scrolling. Runs take longer."
        checked={draft.inputPacing === "human"}
        onChange={(human) => setDraft({ ...draft, inputPacing: human ? "human" : "instant" })}
      />
      <SwitchField
        label="Use native window size"
        hint="Uses the actual browser window instead of a fixed test viewport."
        checked={draft.nativeWindow}
        onChange={(nativeWindow) => setDraft({ ...draft, nativeWindow })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Language" htmlFor={localeId} hint="Leave blank for the browser default.">
          <Input
            id={localeId}
            value={locale}
            onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
            placeholder="en-US"
          />
        </Field>
        <Field label="Timezone" htmlFor={timezoneId} hint="Leave blank for the host timezone.">
          <Input
            id={timezoneId}
            value={timezone}
            onChange={(e) => setDraft({ ...draft, timezoneId: e.target.value })}
            placeholder="Europe/Berlin"
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save browser behavior
        </Button>
        <Button
          aria-label="Reset browser behavior fields"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            useUiStore.getState().clearForm("browserBehavior");
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
