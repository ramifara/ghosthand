// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import "./styles.css";
import { DEFAULT_VARIANT } from "@ghosthand/testbed-kit/variant";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { api } from "./lib/api.ts";
import { resolveVariant, setActiveVariant } from "./lib/variant.ts";

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root");
  // The variant must be known before the first render so tid() is stable.
  const config = await api.config();
  const server = config.ok ? config.value : { variant: DEFAULT_VARIANT, resetId: 0, now: "" };
  setActiveVariant(resolveVariant(server, window.location.search, window.localStorage));
  createRoot(root).render(
    <StrictMode>
      <App now={server.now} />
    </StrictMode>,
  );
}

void boot();
