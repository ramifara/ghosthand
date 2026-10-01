// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "./components/app-shell.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { VariantChrome } from "./components/variant-chrome.tsx";
import { SessionProvider } from "./lib/session-context.tsx";
import { ToastProvider } from "./lib/toast-context.tsx";
import { AccountPage } from "./pages/account-page.tsx";
import { BioPage } from "./pages/bio-page.tsx";
import { CatalogPage } from "./pages/catalog-page.tsx";
import { EmailCodePage } from "./pages/email-code-page.tsx";
import { EmailLinkPage } from "./pages/email-link-page.tsx";
import { ForgotPasswordPage } from "./pages/forgot-password-page.tsx";
import { HomePage } from "./pages/home-page.tsx";
import { InboxPage } from "./pages/inbox-page.tsx";
import { LabGiftFramePage } from "./pages/lab-gift-frame-page.tsx";
import { LabRoutes } from "./pages/lab-routes.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { MagicLinkPage } from "./pages/magic-link-page.tsx";
import { MailboxPage } from "./pages/mailbox-page.tsx";
import { NotFoundPage } from "./pages/not-found-page.tsx";
import { OrdersPage } from "./pages/orders-page.tsx";
import { PreferencesPage } from "./pages/preferences-page.tsx";
import { ProfilePage } from "./pages/profile-page.tsx";
import { ReportsPage } from "./pages/reports-page.tsx";
import { ResetPasswordPage } from "./pages/reset-password-page.tsx";
import { ReviewsPage } from "./pages/reviews-page.tsx";
import { SettingsPage } from "./pages/settings-page.tsx";
import { StatusPage } from "./pages/status-page.tsx";
import { TotpPage } from "./pages/totp-page.tsx";

export function App({ now }: { now: string }) {
  return (
    <SessionProvider>
      <TooltipProvider delayDuration={300}>
        <ToastProvider>
          <VariantChrome />
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell now={now} />}>
                <Route index element={<HomePage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="inbox" element={<InboxPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="bio" element={<BioPage />} />
                <Route path="catalog" element={<CatalogPage />} />
                <Route path="reviews" element={<ReviewsPage />} />
                <Route path="account" element={<AccountPage />} />
                <Route path="lab/*" element={<LabRoutes />} />
                <Route path="login/totp" element={<TotpPage />} />
                <Route path="login/email-link" element={<EmailLinkPage />} />
                <Route path="login/magic" element={<MagicLinkPage />} />
                <Route path="login/email-code" element={<EmailCodePage />} />
                <Route path="login/forgot" element={<ForgotPasswordPage />} />
                <Route path="login/reset" element={<ResetPasswordPage />} />
                <Route path="mailbox" element={<MailboxPage />} />
                <Route path="status" element={<StatusPage />} />
                <Route path="preferences" element={<PreferencesPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              {/* Same-origin iframe content for /lab/checkout: no app shell. */}
              <Route path="lab-frames/gift-message" element={<LabGiftFramePage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}
