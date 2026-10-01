// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Auto-dismissing toasts in a polite live region. Each toast stays TOAST_DURATION_MS and may carry
// one action (e.g. Undo). Timing is fixed, never randomized, so tasks are reproducible.
import { TOAST_DURATION_MS } from "@ghosthand/testbed-kit/orders";
import { X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button.tsx";
import { tid } from "./tid.ts";

export interface ToastInput {
  message: string;
  action?: { label: string; onClick: () => void };
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastValue {
  toast(input: ToastInput): void;
}

const ToastContext = createContext<ToastValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const toast = useCallback((input: ToastInput) => {
    const id = nextId++;
    setToasts((all) => [...all, { ...input, id }]);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      >
        <div role="status" aria-live="polite" className="flex flex-col gap-2" {...tid("toasts")}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);
  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-sm shadow-lg"
      {...tid("toast")}
    >
      <p className="flex-1">{toast.message}</p>
      {toast.action ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          {...tid("toast.action")}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        {...tid("toast.dismiss")}
      >
        <X aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast outside ToastProvider");
  return value;
}
