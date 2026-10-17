// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L6 icon toolbar (ADR 0020): four icon-only buttons. With `a11y: "poor"` they carry no name, no title
// and no tooltip, so the element table shows four unnamed buttons and the agent must look at the icons.
import { TOOLBAR_PANES, type ToolbarPane } from "@ghosthand/testbed-kit/lab";
import { Download, Search, Settings, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { LabPage, type LabStatus, LabStatusLine } from "../components/lab-page.tsx";
import { labApi } from "../lib/lab-api.ts";
import { tid } from "../lib/tid.ts";
import { activeVariant } from "../lib/variant.ts";

const ICONS: Record<ToolbarPane, typeof Search> = {
  search: Search,
  filters: SlidersHorizontal,
  export: Download,
  settings: Settings,
};

const PANE_TEXT: Record<ToolbarPane, string> = {
  search: "Type to search the list.",
  filters: "Filter results by status, owner and date.",
  export: "Download the current list as CSV.",
  settings: "Change how the list is shown.",
};

export function LabToolbarPage() {
  return (
    <LabPage title="Toolbar" description="A compact toolbar above a list." what="use the toolbar">
      {() => <Toolbar />}
    </LabPage>
  );
}

function Toolbar() {
  const poor = activeVariant().a11y === "poor";
  const [open, setOpen] = useState<ToolbarPane | undefined>(undefined);
  const [status, setStatus] = useState<LabStatus>(undefined);
  const openPane = async (pane: ToolbarPane) => {
    const res = await labApi.openPane(pane);
    if (res.ok) setOpen(pane);
    setStatus(res.ok ? { ok: true, text: res.value.message } : { ok: false, text: res.message });
  };
  return (
    <div className="space-y-3">
      <div
        className="flex w-fit items-center gap-1 rounded-md border border-border bg-panel p-1"
        {...tid("toolbar")}
      >
        {(Object.keys(TOOLBAR_PANES) as ToolbarPane[]).map((pane) => {
          const Icon = ICONS[pane];
          return (
            <button
              key={pane}
              type="button"
              className="rounded p-2 hover:bg-muted/40"
              onClick={() => void openPane(pane)}
              {...(poor ? {} : { "aria-label": TOOLBAR_PANES[pane], title: TOOLBAR_PANES[pane] })}
              {...tid(`toolbar.${pane}`)}
            >
              <Icon aria-hidden="true" size={18} />
            </button>
          );
        })}
      </div>
      {open ? (
        <section className="w-fit rounded-md border border-border bg-panel p-3" {...tid("toolbar.pane")}>
          <h2 className="text-sm font-semibold">{TOOLBAR_PANES[open]}</h2>
          <p className="text-sm text-muted">{PANE_TEXT[open]}</p>
        </section>
      ) : null}
      <LabStatusLine status={status} />
    </div>
  );
}
