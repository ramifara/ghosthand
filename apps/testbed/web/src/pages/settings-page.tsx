// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// L3: settings in tabs. Notifications has a slider; Advanced hides developer controls in an
// accordion, behind icon-only buttons whose purpose is shown in a tooltip.
import { DIGEST_OPTIONS, Digest, EMAIL_LIMIT, type SettingsRow } from "@ghosthand/testbed-kit/settings";
import { KeyRound, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { RequireSession } from "../components/require-session.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../components/ui/accordion.tsx";
import { Alert } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Label } from "../components/ui/label.tsx";
import { Checkbox, NativeSelect } from "../components/ui/select.tsx";
import { Slider } from "../components/ui/slider.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { api, type SettingsResponse } from "../lib/api.ts";
import { tid } from "../lib/tid.ts";
import { useToast } from "../lib/toast-context.tsx";

const DIGEST_LABELS: Record<Digest, string> = { off: "Off", daily: "Daily", weekly: "Weekly" };

export function SettingsPage() {
  return <RequireSession what="change your settings">{() => <SettingsView />}</RequireSession>;
}

function SettingsView() {
  const [data, setData] = useState<SettingsResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void api.settings().then((res) => (res.ok ? setData(res.value) : setError(res.message)));
  }, []);

  return (
    <Card className="max-w-2xl" aria-labelledby="settings-title">
      <CardHeader>
        <CardTitle as="h1" id="settings-title" className="text-base">
          Settings
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {data ? (
          <Tabs defaultValue="general">
            <TabsList aria-label="Settings sections">
              <TabsTrigger value="general" {...tid("settings.tab.general")}>
                General
              </TabsTrigger>
              <TabsTrigger value="notifications" {...tid("settings.tab.notifications")}>
                Notifications
              </TabsTrigger>
              <TabsTrigger value="advanced" {...tid("settings.tab.advanced")}>
                Advanced
              </TabsTrigger>
            </TabsList>
            <TabsContent value="general">
              <GeneralTab settings={data.settings} onSaved={setData} />
            </TabsContent>
            <TabsContent value="notifications">
              <NotificationsTab settings={data.settings} onSaved={setData} />
            </TabsContent>
            <TabsContent value="advanced">
              <AdvancedTab data={data} onChanged={setData} />
            </TabsContent>
          </Tabs>
        ) : error ? null : (
          <p className="text-muted">Loading…</p>
        )}
      </CardContent>
    </Card>
  );
}

function GeneralTab({ settings, onSaved }: { settings: SettingsRow; onSaved(s: SettingsResponse): void }) {
  const [compact, setCompact] = useState(settings.compactTables);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | undefined>(undefined);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await api.saveGeneral({ compactTables: compact });
    if (!res.ok) return setMessage({ ok: false, text: res.message });
    onSaved(res.value);
    setMessage({ ok: true, text: res.value.message ?? "" });
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void onSubmit(e)} {...tid("settings.general")}>
      {message ? <Alert variant={message.ok ? "success" : "destructive"}>{message.text}</Alert> : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id="settings-compact"
          checked={compact}
          onChange={(e) => setCompact(e.target.checked)}
          {...tid("settings.compact")}
        />
        <Label htmlFor="settings-compact">Compact tables</Label>
      </div>
      <Button type="submit" {...tid("settings.general.save")}>
        Save general settings
      </Button>
    </form>
  );
}

function NotificationsTab({
  settings,
  onSaved,
}: {
  settings: SettingsRow;
  onSaved(s: SettingsResponse): void;
}) {
  const [limit, setLimit] = useState(settings.emailLimit);
  const [digest, setDigest] = useState<Digest>(settings.digest);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | undefined>(undefined);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await api.saveNotifications({ emailLimit: limit, digest });
    if (!res.ok) return setMessage({ ok: false, text: res.message });
    onSaved(res.value);
    setMessage({ ok: true, text: res.value.message ?? "" });
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void onSubmit(e)} {...tid("settings.notifications")}>
      {message ? (
        <Alert variant={message.ok ? "success" : "destructive"} {...tid("settings.notifications.message")}>
          {message.text}
        </Alert>
      ) : null}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label id="settings-email-limit-label">Daily email limit</Label>
          <output
            htmlFor="settings-email-limit"
            className="font-mono text-sm"
            {...tid("settings.email-limit.value")}
          >
            {`${limit} emails`}
          </output>
        </div>
        <Slider
          id="settings-email-limit"
          min={EMAIL_LIMIT.min}
          max={EMAIL_LIMIT.max}
          step={EMAIL_LIMIT.step}
          value={[limit]}
          onValueChange={(v) => {
            setLimit(v[0] ?? limit);
            setMessage(undefined);
          }}
          thumbLabelledBy="settings-email-limit-label"
          thumbProps={tid("settings.email-limit")}
        />
        <p className="text-xs text-muted">{`From ${EMAIL_LIMIT.min} to ${EMAIL_LIMIT.max}, in steps of ${EMAIL_LIMIT.step}. Use the arrow keys for fine control.`}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="settings-digest">Digest</Label>
        <NativeSelect
          id="settings-digest"
          value={digest}
          onChange={(e) => setDigest(Digest.parse(e.target.value))}
          {...tid("settings.digest")}
        >
          {DIGEST_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {DIGEST_LABELS[d]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" {...tid("settings.notifications.save")}>
        Save notification settings
      </Button>
    </form>
  );
}

function AdvancedTab({ data, onChanged }: { data: SettingsResponse; onChanged(s: SettingsResponse): void }) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function run(action: () => ReturnType<typeof api.rotateWebhookSecret>) {
    setPending(true);
    const res = await action();
    setPending(false);
    if (!res.ok) return toast({ message: res.message });
    onChanged(res.value);
    toast({ message: res.value.message ?? "" });
  }

  return (
    <Accordion type="single" collapsible {...tid("settings.advanced")}>
      <AccordionItem value="sessions">
        <AccordionTrigger {...tid("settings.advanced.sessions")}>Sessions</AccordionTrigger>
        <AccordionContent>
          <p className="text-muted">Sessions end when the testbed resets. There is nothing to manage here.</p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="developer">
        <AccordionTrigger {...tid("settings.advanced.developer")}>Developer</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted">API key</p>
              <p className="font-mono" {...tid("settings.api-key")}>
                {data.settings.apiKeyRevoked ? "Revoked" : data.apiKeyPreview}
              </p>
            </div>
            <Tooltip label="Revoke API key">
              <Button
                variant="outline"
                size="sm"
                aria-label="Revoke API key"
                disabled={pending || data.settings.apiKeyRevoked}
                onClick={() => void run(api.revokeApiKey)}
                {...tid("settings.api-key.revoke")}
              >
                <KeyRound aria-hidden="true" className="size-3.5" />
              </Button>
            </Tooltip>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-muted">Webhook signing secret</p>
              <p className="font-mono" {...tid("settings.webhook-version")}>
                {`Webhook secret version ${data.settings.webhookSecretVersion}`}
              </p>
            </div>
            <Tooltip label="Rotate webhook secret">
              <Button
                variant="outline"
                size="sm"
                aria-label="Rotate webhook secret"
                disabled={pending}
                onClick={() => void run(api.rotateWebhookSecret)}
                {...tid("settings.webhook.rotate")}
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
              </Button>
            </Tooltip>
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="data">
        <AccordionTrigger {...tid("settings.advanced.data")}>Data</AccordionTrigger>
        <AccordionContent>
          <p className="text-muted">Exports are turned off in the testbed.</p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
