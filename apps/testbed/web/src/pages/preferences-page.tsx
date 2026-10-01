// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L6 contact preferences: a plain form the robustness variants are applied to. `locale` swaps the strings,
// `ids: "dynamic"` re-rolls ids and class names on every render, `layoutShift` inserts a notice above the
// save button after the first change, `a11y: "poor"` swaps labelled controls for a placeholder-only input,
// clickable divs and an unnamed icon toggle. Latency and the transient 503 come from the server.
import {
  CONTACT_METHODS,
  type ContactPrefsRow,
  PHONE_PATTERN,
  PREFERENCES_STRINGS,
  type PreferencesStrings,
} from "@ghosthand/testbed-kit/preferences";
import { BellOff, BellRing, RotateCw } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { RequireSession } from "../components/require-session.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { Checkbox } from "../components/ui/select.tsx";
import { authApi } from "../lib/auth-api.ts";
import { cn } from "../lib/cn.ts";
import { tid } from "../lib/tid.ts";
import { activeVariant } from "../lib/variant.ts";

/** Delay between the first edit and the layout shift. */
export const LAYOUT_SHIFT_DELAY_MS = 700;

type Form = Pick<ContactPrefsRow, "phone" | "method" | "news">;

function randomToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Stable ids normally; fresh random ids and class names on every render under `ids: "dynamic"`. */
function idMaker(dynamic: boolean) {
  const make = (name: string) => (dynamic ? `${name}-${randomToken()}` : `prefs-${name}`);
  const cls = () => (dynamic ? `c${randomToken()}` : "");
  return { make, cls };
}

export function PreferencesPage() {
  return (
    <RequireSession what="change your contact preferences">{() => <PreferencesLoader />}</RequireSession>
  );
}

function PreferencesLoader() {
  const variant = activeVariant();
  const t: PreferencesStrings = PREFERENCES_STRINGS[variant.locale ?? "en"];
  const [prefs, setPrefs] = useState<ContactPrefsRow | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const res = await authApi.preferences();
    setLoading(false);
    if (res.ok) setPrefs(res.value.prefs);
    else setFailed(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="max-w-lg" aria-labelledby="prefs-title" lang={variant.locale ?? "en"}>
      <CardHeader>
        <CardTitle as="h1" id="prefs-title" className="text-base">
          {t.title}
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted" role="status" aria-live="polite">
            {t.loading}
          </p>
        ) : null}
        {!loading && failed ? (
          <div className="space-y-2">
            <Alert variant="destructive">{t.loadFailed}</Alert>
            <Button variant="outline" onClick={() => void load()} {...tid("prefs.retry")}>
              <RotateCw aria-hidden="true" className="size-3.5" />
              {t.retry}
            </Button>
          </div>
        ) : null}
        {!loading && prefs ? <PreferencesForm t={t} initial={prefs} /> : null}
      </CardContent>
    </Card>
  );
}

function PreferencesForm({ t, initial }: { t: PreferencesStrings; initial: ContactPrefsRow }) {
  const variant = activeVariant();
  const poor = variant.a11y === "poor";
  const { make, cls } = idMaker(variant.ids === "dynamic");
  const [form, setForm] = useState<Form>({
    phone: initial.phone,
    method: initial.method,
    news: initial.news,
  });
  const [dirty, setDirty] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const saving = useRef(false);

  useEffect(() => {
    if (variant.layoutShift !== "on" || !dirty || shifted) return;
    const timer = setTimeout(() => setShifted(true), LAYOUT_SHIFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [variant.layoutShift, dirty, shifted]);

  function change(next: Partial<Form>) {
    setForm((f) => ({ ...f, ...next }));
    setDirty(true);
    setMessage(undefined);
  }

  async function save() {
    if (saving.current) return;
    setError(undefined);
    setMessage(undefined);
    if (!PHONE_PATTERN.test(form.phone.trim())) {
      setError(t.invalidPhone);
      return;
    }
    saving.current = true;
    setPending(true);
    const res = await authApi.savePreferences({ ...form, phone: form.phone.trim() });
    saving.current = false;
    setPending(false);
    if (!res.ok) {
      setError(res.fieldErrors?.phone ? t.invalidPhone : res.message);
      return;
    }
    setMessage(t.saved);
  }

  async function unsubscribe() {
    setPending(true);
    const res = await authApi.unsubscribeAll();
    setPending(false);
    if (res.ok) {
      setForm((f) => ({ ...f, news: false }));
      setMessage(t.unsubscribed);
    } else setError(res.message);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  const phoneId = make("phone");
  const newsId = make("news");
  const saveLabel = pending ? t.saving : t.save;

  return (
    <form className={cn("space-y-4", cls())} onSubmit={onSubmit} noValidate {...tid("prefs.form")}>
      {message ? (
        <Alert variant="success" {...tid("prefs.message")}>
          {message}
        </Alert>
      ) : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {poor ? (
        <div className={cn("pref-item space-y-1", cls())}>
          {/* A text that looks like a label but isn't one; the placeholder is the only accessible name. */}
          <div className="text-xs font-medium">{t.phone}</div>
          <input
            className="h-8 w-full rounded-md border border-border bg-panel px-2.5 text-sm"
            placeholder={t.phone}
            value={form.phone}
            onChange={(e) => change({ phone: e.target.value })}
          />
        </div>
      ) : (
        <div className={cn("space-y-1", cls())}>
          <Label htmlFor={phoneId}>{t.phone}</Label>
          <Input
            id={phoneId}
            name="phone"
            type="tel"
            autoComplete="tel"
            dir="ltr"
            className={cls()}
            value={form.phone}
            onChange={(e) => change({ phone: e.target.value })}
            {...tid("prefs.phone")}
          />
        </div>
      )}

      {poor ? (
        <div className={cn("pref-item space-y-1", cls())}>
          <div className="text-xs font-medium">{t.method}</div>
          <div className="flex gap-2">
            {CONTACT_METHODS.map((m) => (
              // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: deliberately inaccessible (a11y: "poor")
              <div
                key={m}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm",
                  form.method === m ? "border-accent bg-accent-soft" : "border-border",
                )}
                onClick={() => change({ method: m })}
              >
                {/* Selection is shown only as a check glyph in the text: no role, no aria-checked. */}
                <span className="w-3 text-accent">{form.method === m ? "✓" : ""}</span>
                {t.methods[m]}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <fieldset className={cn("space-y-1", cls())}>
          <legend className="text-xs font-medium">{t.method}</legend>
          <div className="flex flex-wrap gap-3">
            {CONTACT_METHODS.map((m) => {
              const id = make(`method-${m}`);
              return (
                <label key={m} htmlFor={id} className={cn("flex items-center gap-1.5 text-sm", cls())}>
                  <input
                    id={id}
                    type="radio"
                    name="method"
                    value={m}
                    checked={form.method === m}
                    onChange={() => change({ method: m })}
                    {...tid(`prefs.method.${m}`)}
                  />
                  {t.methods[m]}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {poor ? (
        <div className={cn("pref-item flex items-center gap-2 text-sm", cls())}>
          {/* Deliberately unnamed icon-only toggle without aria-pressed: only the icon shows its state. */}
          <button
            type="button"
            className={cn(
              "rounded-md border p-1.5",
              form.news ? "border-accent text-accent" : "border-border text-muted",
            )}
            onClick={() => change({ news: !form.news })}
          >
            {form.news ? (
              <BellRing aria-hidden="true" className="size-4" />
            ) : (
              <BellOff aria-hidden="true" className="size-4" />
            )}
          </button>
          <span>{t.news}</span>
        </div>
      ) : (
        <div className={cn("flex items-center gap-2", cls())}>
          <Checkbox
            id={newsId}
            className={cls()}
            checked={form.news}
            onChange={(e) => change({ news: e.target.checked })}
            {...tid("prefs.news")}
          />
          <Label htmlFor={newsId} className="text-sm font-normal">
            {t.news}
          </Label>
        </div>
      )}

      {shifted ? (
        <div
          className="space-y-2 rounded-md border border-border bg-accent-soft p-3"
          {...tid("prefs.shift-notice")}
        >
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void unsubscribe()}
            {...tid("prefs.unsubscribe")}
          >
            {t.unsubscribe}
          </Button>
          <p className="text-sm">{t.shiftNotice}</p>
        </div>
      ) : null}

      {poor ? (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: deliberately inaccessible (a11y: "poor")
        <div
          className={cn(
            "inline-flex h-8 cursor-pointer items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground",
            pending && "pointer-events-none opacity-50",
          )}
          onClick={() => void save()}
        >
          {saveLabel}
        </div>
      ) : (
        <Button type="submit" disabled={pending} className={cls()} {...tid("prefs.save")}>
          {saveLabel}
        </Button>
      )}
    </form>
  );
}
