// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 extras on the sign-in card: other ways to sign in (all links, so "Sign in" stays the only button)
// and notices for the redirects back to /login (SSO cancelled or failed, password reset done).
import { AUTH_MESSAGES, IDP_NAME } from "@ghosthand/testbed-kit/auth";
import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { cn } from "../lib/cn.ts";
import { tid } from "../lib/tid.ts";
import { Alert } from "./ui/alert.tsx";

const linkButton = cn(
  "flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-panel text-sm",
  "font-medium text-foreground hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent",
);

export function LoginAlternatives() {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-right text-xs">
        <Link to="/login/forgot" className="text-accent underline" {...tid("login.forgot")}>
          Forgot password?
        </Link>
      </p>
      <p className="flex items-center gap-2 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </p>
      <Link to="/login/email-link" className={linkButton} {...tid("login.magic-link")}>
        <Mail aria-hidden="true" className="size-3.5" />
        Email me a sign-in link
      </Link>
      <Link to="/login/email-code" className={linkButton} {...tid("login.email-code")}>
        <KeyRound aria-hidden="true" className="size-3.5" />
        Email me a sign-in code
      </Link>
      {/* A full page load: the server answers with a redirect to the IdP's origin. */}
      <a href="/api/sso/start" className={linkButton} {...tid("login.sso")}>
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        {`Sign in with ${IDP_NAME}`}
      </a>
    </div>
  );
}

export function LoginNotices({ params }: { params: URLSearchParams }) {
  const sso = params.get("sso");
  const reset = params.get("reset");
  if (sso === "denied" || sso === "failed") {
    return (
      <Alert variant="destructive" className="mb-3">
        {sso === "denied" ? AUTH_MESSAGES.ssoDenied : AUTH_MESSAGES.ssoFailed}
      </Alert>
    );
  }
  if (reset === "done") {
    return (
      <Alert variant="success" className="mb-3">
        {AUTH_MESSAGES.passwordReset}
      </Alert>
    );
  }
  return null;
}
