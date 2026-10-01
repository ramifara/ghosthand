// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L5 password reset, step 1: ask for a reset link by email.
import { useState } from "react";
import { AuthCard, BackToSignIn, MailboxLink } from "../components/auth-card.tsx";
import { EmailRequestForm } from "../components/email-request-form.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { authApi } from "../lib/auth-api.ts";

export function ForgotPasswordPage() {
  const [sent, setSent] = useState<{ email: string; message: string } | undefined>(undefined);
  return (
    <AuthCard title="Reset your password" description="We'll email you a link to choose a new password.">
      {sent ? (
        <>
          <Alert variant="success">{sent.message}</Alert>
          <MailboxLink address={sent.email} />
        </>
      ) : (
        <EmailRequestForm
          id="reset"
          submitLabel="Send reset link"
          send={authApi.requestReset}
          onSent={(email, message) => setSent({ email, message })}
        />
      )}
      <BackToSignIn />
    </AuthCard>
  );
}
