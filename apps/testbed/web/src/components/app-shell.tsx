// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { LogOut } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { useSession } from "../lib/session-context.tsx";
import { tid } from "../lib/tid.ts";
import { Button } from "./ui/button.tsx";

const links = [
  { to: "/", label: "Home", id: "nav.home" },
  { to: "/profile", label: "Profile", id: "nav.profile" },
  { to: "/inbox", label: "Inbox", id: "nav.inbox" },
  { to: "/orders", label: "Orders", id: "nav.orders" },
  { to: "/reports", label: "Reports", id: "nav.reports" },
  { to: "/settings", label: "Settings", id: "nav.settings" },
  { to: "/bio", label: "Bio", id: "nav.bio" },
  { to: "/account", label: "Account", id: "nav.account" },
];

export function AppShell({ now }: { now: string }) {
  const { user, setUser } = useSession();
  const navigate = useNavigate();

  async function signOut() {
    await api.logout();
    setUser(null);
    void navigate("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-panel">
        <div className="mx-auto flex h-11 max-w-5xl items-center gap-4 px-4">
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold whitespace-nowrap">
            <img
              src="/brand/ghosthand-32.png"
              srcSet="/brand/ghosthand-32.png 1x, /brand/ghosthand-64.png 2x"
              width={24}
              height={24}
              alt=""
              aria-hidden="true"
              className="shrink-0"
            />
            GhostHand testbed
          </span>
          <nav aria-label="Main" className="flex items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end
                {...tid(l.id)}
                className={({ isActive }) =>
                  cn(
                    "rounded px-2 py-1 text-sm hover:bg-accent-soft",
                    "focus-visible:outline-2 focus-visible:outline-accent",
                    isActive ? "font-medium text-accent" : "text-muted",
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs whitespace-nowrap">
            {user ? (
              <>
                <span className="font-mono text-muted" {...tid("session.user")}>
                  {`Signed in as ${user.email}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void signOut()}
                  {...tid("session.signout")}
                >
                  <LogOut aria-hidden="true" className="size-3.5" />
                  Sign out
                </Button>
              </>
            ) : user === null ? (
              <Button asChild variant="outline" size="sm">
                <NavLink to="/login" {...tid("session.signin")}>
                  Sign in
                </NavLink>
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-border px-4 py-2 text-center font-mono text-xs text-muted">
        Server time {now}
      </footer>
    </div>
  );
}
