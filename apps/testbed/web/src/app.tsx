// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "./components/app-shell.tsx";
import { SessionProvider } from "./lib/session-context.tsx";
import { HomePage } from "./pages/home-page.tsx";
import { InboxPage } from "./pages/inbox-page.tsx";
import { LoginPage } from "./pages/login-page.tsx";
import { NotFoundPage } from "./pages/not-found-page.tsx";
import { ProfilePage } from "./pages/profile-page.tsx";

export function App({ now }: { now: string }) {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell now={now} />}>
            <Route index element={<HomePage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
