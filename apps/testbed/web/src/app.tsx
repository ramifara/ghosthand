// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "./components/app-shell.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { SessionProvider } from "./lib/session-context.tsx";
import { ToastProvider } from "./lib/toast-context.tsx";
import { BioPage } from "./pages/bio-page.tsx";
import { HomePage } from "./pages/home-page.tsx";
import { InboxPage } from "./pages/inbox-page.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { NotFoundPage } from "./pages/not-found-page.tsx";
import { OrdersPage } from "./pages/orders-page.tsx";
import { ProfilePage } from "./pages/profile-page.tsx";
import { ReportsPage } from "./pages/reports-page.tsx";
import { SettingsPage } from "./pages/settings-page.tsx";

export function App({ now }: { now: string }) {
  return (
    <SessionProvider>
      <TooltipProvider delayDuration={300}>
        <ToastProvider>
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
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </TooltipProvider>
    </SessionProvider>
  );
}
