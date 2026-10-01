// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Profile form with client validation (shared rules) and server validation (adds handle uniqueness).
import {
  type FieldErrors,
  type ProfileField,
  type ProfileInput,
  validateProfile,
} from "@ghosthand/testbed-kit/profile-schema";
import { Save } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input, Textarea } from "../components/ui/input.tsx";
import { Label } from "../components/ui/label.tsx";
import { api, type User } from "../lib/api.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";

const FIELDS: Array<{ key: ProfileField; label: string; hint?: string; multiline?: boolean }> = [
  { key: "name", label: "Display name" },
  { key: "handle", label: "Handle", hint: "3 to 20 characters: lowercase letters, digits or hyphens." },
  { key: "title", label: "Job title" },
  { key: "website", label: "Website", hint: "A full https:// URL, or leave empty." },
  { key: "bio", label: "Bio", hint: "Up to 160 characters.", multiline: true },
];

function toForm(user: User): ProfileInput {
  return { name: user.name, handle: user.handle, title: user.title, website: user.website, bio: user.bio };
}

export function ProfilePage() {
  const { user } = useSession();
  if (user === undefined) return <p className="text-muted">Loading…</p>;
  if (user === null) {
    return (
      <Alert variant="info" role="alert">
        You need to sign in to edit your profile.{" "}
        <Link to="/login" className="text-accent underline">
          Sign in
        </Link>
      </Alert>
    );
  }
  return <ProfileForm user={user} />;
}

function ProfileForm({ user }: { user: User }) {
  const { setUser } = useSession();
  const [form, setForm] = useState<ProfileInput>(() => toForm(user));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const refs = useRef<Partial<Record<ProfileField, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  useEffect(() => {
    const first = FIELDS.find((f) => errors[f.key]);
    if (first) refs.current[first.key]?.focus();
  }, [errors]);

  function update(key: ProfileField, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(undefined);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(undefined);
    setFormError(undefined);
    const checked = validateProfile(form);
    if (!checked.ok) {
      setErrors(checked.fieldErrors);
      setFormError("Fix the highlighted fields and save again.");
      return;
    }
    setErrors({});
    setPending(true);
    const res = await api.updateProfile(checked.value);
    setPending(false);
    if (!res.ok) {
      if (res.fieldErrors) {
        setErrors(res.fieldErrors);
        setFormError("Fix the highlighted fields and save again.");
      } else {
        setFormError(res.message);
      }
      return;
    }
    setUser(res.value.user);
    setForm(toForm(res.value.user));
    setSaved(res.value.message);
  }

  return (
    <Card className="max-w-xl" aria-labelledby="profile-heading">
      <CardHeader>
        <CardTitle as="h1" id="profile-heading" className="text-base">
          Profile
        </CardTitle>
        <CardDescription>
          Signed in with <span className="font-mono">{user.email}</span>. Your email can't be changed here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} noValidate {...tid("profile.form")}>
          {formError ? (
            <Alert variant="destructive" {...tid("profile.error")}>
              {formError}
            </Alert>
          ) : null}
          {saved ? (
            <Alert variant="success" {...tid("profile.saved")}>
              {saved}
            </Alert>
          ) : null}
          {FIELDS.map((f) => {
            const id = `profile-${f.key}`;
            const error = errors[f.key];
            const describedBy = [error ? `${id}-error` : undefined, f.hint ? `${id}-hint` : undefined]
              .filter(Boolean)
              .join(" ");
            const common = {
              id,
              name: f.key,
              value: form[f.key],
              "aria-invalid": error ? true : undefined,
              "aria-describedby": describedBy || undefined,
              ...tid(`profile.${f.key}`),
            };
            return (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={id}>{f.label}</Label>
                {f.multiline ? (
                  <Textarea
                    {...common}
                    ref={(el) => {
                      refs.current[f.key] = el;
                    }}
                    onChange={(e) => update(f.key, e.target.value)}
                  />
                ) : (
                  <Input
                    {...common}
                    ref={(el) => {
                      refs.current[f.key] = el;
                    }}
                    onChange={(e) => update(f.key, e.target.value)}
                  />
                )}
                {f.hint ? (
                  <p id={`${id}-hint`} className="text-xs text-muted">
                    {f.hint}
                  </p>
                ) : null}
                {error ? (
                  <p id={`${id}-error`} className="text-xs text-bad" {...tid(`profile.${f.key}.error`)}>
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
          <Button type="submit" disabled={pending} {...tid("profile.save")}>
            <Save aria-hidden="true" className="size-3.5" />
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
