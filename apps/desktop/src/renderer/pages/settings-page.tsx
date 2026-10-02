// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import * as Tabs from "@radix-ui/react-tabs";
import { BrowserBehaviorSection } from "../features/settings/browser-behavior-section.tsx";
import { BrowserNetworkSection } from "../features/settings/browser-network-section.tsx";
import { DeveloperSection } from "../features/settings/developer-section.tsx";
import { ModelsSection } from "../features/settings/models-section.tsx";
import { ProfilesSection } from "../features/settings/profiles-section.tsx";
import { ProvidersSection } from "../features/settings/providers-section.tsx";
import { DownloadsSection, RunDefaultsSection } from "../features/settings/run-defaults-section.tsx";
import { useUiStore } from "../stores/ui-store.ts";

const TABS = [
  ["providers", "Providers", ProvidersSection],
  ["models", "Models", ModelsSection],
  ["profiles", "Profiles", ProfilesSection],
  ["browser", "Browser", BrowserSection],
  ["budgets", "Budgets", RunDefaultsSection],
  ["downloads", "Downloads", DownloadsSection],
  ["developer", "Developer", DeveloperSection],
] as const;

function BrowserSection() {
  return (
    <>
      <BrowserBehaviorSection />
      <BrowserNetworkSection />
    </>
  );
}

export function SettingsPage() {
  const tab = useUiStore((state) => state.setupTab);
  const selectTab = useUiStore((state) => state.selectSetupTab);
  return (
    <Tabs.Root
      value={tab}
      onValueChange={selectTab}
      orientation="vertical"
      className="grid h-full grid-cols-[11rem_1fr]"
    >
      <Tabs.List aria-label="Setup" className="flex flex-col gap-0.5 border-r border-line bg-panel p-2">
        <p className="label px-2 pt-1 pb-2">Setup</p>
        {TABS.map(([value, label]) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className="rounded-[5px] px-2 py-1.5 text-left text-muted hover:bg-panel-2 hover:text-ink data-[state=active]:bg-accent-soft data-[state=active]:text-accent"
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {TABS.map(([value, label, Section]) => (
        <Tabs.Content key={value} value={value} className="overflow-y-auto p-6">
          <h1 className="mb-4 text-lg font-semibold tracking-tight">{label}</h1>
          <Section />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
