// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type User } from "./api.ts";

interface SessionValue {
  /** undefined while loading, null when signed out. */
  user: User | null | undefined;
  setUser(user: User | null): void;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    const res = await api.me();
    setUser(res.ok ? res.value.user : null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const value = useMemo(() => ({ user, setUser, refresh }), [user, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
