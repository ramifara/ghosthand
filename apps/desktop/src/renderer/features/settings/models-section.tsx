// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Per-role model selection. Each role lists only models whose capabilities meet it (from the catalog),
// with badges for what each model can do. Jev (decision) is fixed and served by TypeSafe.
import type {
  ChatRoleName,
  DecisionImages,
  ModelListItem,
  RoleBindingsInput,
  Settings,
} from "@ghosthand/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Field, Input, Select } from "../../components/ui/field.tsx";
import { call, errorMessage } from "../../lib/bridge.ts";
import { formatTokens } from "../../lib/format.ts";
import { useUiStore } from "../../stores/ui-store.ts";

const ROLES: Array<{ role: ChatRoleName; label: string; needs: string }> = [
  { role: "planner", label: "Planner", needs: "structured output · 64k context" },
  { role: "writer", label: "Writer", needs: "text · 16k context" },
  { role: "vision_reviewer", label: "Vision reviewer", needs: "images · structured output" },
  { role: "vision_grounder", label: "Vision grounder", needs: "images · computer use or grounding" },
  { role: "judge", label: "Judge", needs: "images · structured output · 64k" },
];

export function CapabilityBadges({ model }: { model: ModelListItem }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge title="context window">{formatTokens(model.contextTokens)}</Badge>
      {model.imageInput ? <Badge title="accepts images">img</Badge> : null}
      {model.structuredOutput ? <Badge title="JSON schema output">json</Badge> : null}
      {model.reasoning ? <Badge title="reasoning model">reason</Badge> : null}
      {model.computerUse ? (
        <Badge tone="accent" title="native computer-use tool">
          cu
        </Badge>
      ) : null}
      {model.access === "set" ? (
        <Badge tone="ok">ready</Badge>
      ) : model.access === "missing" ? (
        <Badge tone="amber">needs key</Badge>
      ) : (
        <Badge>later</Badge>
      )}
    </span>
  );
}

function RoleRow({
  role,
  label,
  needs,
  models,
  value,
  onChange,
}: {
  role: ChatRoleName;
  label: string;
  needs: string;
  models: readonly ModelListItem[];
  value: string[];
  onChange: (models: string[]) => void;
}) {
  const primaryId = useId();
  const fallbackId = useId();
  const eligible = models.filter((m) => m.roles.includes(role));
  const primary = eligible.find((m) => m.ref === value[0]);
  return (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-3 border-b border-line py-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="font-mono text-2xs text-faint">{needs}</p>
      </div>
      <Field
        label="Model"
        htmlFor={primaryId}
        hint={primary ? <CapabilityBadges model={primary} /> : undefined}
      >
        <Select
          id={primaryId}
          value={value[0] ?? ""}
          onChange={(e) => onChange([e.target.value, ...value.slice(1)].filter(Boolean))}
        >
          {value[0] && !primary ? <option value={value[0]}>{value[0]} (not eligible)</option> : null}
          {eligible.map((m) => (
            <option key={m.ref} value={m.ref}>
              {m.ref}
              {m.access === "set" ? "" : m.access === "missing" ? " · needs key" : " · not callable yet"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Fallback" htmlFor={fallbackId}>
        <Select
          id={fallbackId}
          value={value[1] ?? ""}
          onChange={(e) => onChange([value[0] ?? "", e.target.value].filter(Boolean))}
        >
          <option value="">None</option>
          {eligible
            .filter((m) => m.ref !== value[0])
            .map((m) => (
              <option key={m.ref} value={m.ref}>
                {m.ref}
              </option>
            ))}
        </Select>
      </Field>
    </div>
  );
}

const DEFAULT_VISION_MODEL = "jev-1.14.0";
const IMAGE_LEVELS: Array<{ value: DecisionImages; label: string }> = [
  { value: "off", label: "Off: text only" },
  { value: "grounding", label: "Grounding only (D0): a screenshot when the element table has no target" },
  { value: "always", label: "Always: a screenshot with every decision (about 3k tokens per step)" },
];

/** Jev's pins and the screenshot setting (ADR 0020). Images and box are TypeSafe's "danger zone": experimental. */
function DecisionSettings() {
  const qc = useQueryClient();
  const imagesId = useId();
  const visionId = useId();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => call("settings.set", patch),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
  const s = settings.data;
  const visionModel = s?.decisionVisionModel ?? DEFAULT_VISION_MODEL;
  return (
    <div className="grid gap-3 rounded-md border border-line bg-panel-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">decision</span>
        <span className="font-mono text-xs">typesafe/jev-1.13.0</span>
        <span className="text-muted">· vision</span>
        <span className="font-mono text-xs">typesafe/{visionModel}</span>
        <span className="text-muted">— Jev answers every step; the roles below help it.</span>
      </div>
      {s ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="Screenshots to Jev (experimental)"
            htmlFor={imagesId}
            hint='TypeSafe marks image input and box answers as "danger zone": not production-ready, formats and accuracy may change. Secrets are masked before a screenshot leaves the machine.'
          >
            <Select
              id={imagesId}
              value={s.decisionImages}
              onChange={(e) => save.mutate({ decisionImages: e.target.value as DecisionImages })}
            >
              {IMAGE_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Jev vision model"
            htmlFor={visionId}
            hint="Pinned model for requests with a screenshot or a box question. Box needs Jev 1.14; aliases move without notice."
          >
            <Input
              id={visionId}
              defaultValue={visionModel}
              placeholder={DEFAULT_VISION_MODEL}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== visionModel) save.mutate({ decisionVisionModel: v || DEFAULT_VISION_MODEL });
              }}
            />
          </Field>
        </div>
      ) : null}
      {save.error ? <p className="text-danger">{errorMessage(save.error)}</p> : null}
    </div>
  );
}

export function ModelsSection() {
  const qc = useQueryClient();
  const models = useQuery({ queryKey: ["models"], queryFn: () => call("models.list", {}) });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => call("roles.get", {}) });
  const cached = useUiStore((state) => state.forms.roleModels);
  const draft: RoleBindingsInput = cached ?? roles.data ?? {};
  const save = useMutation({
    mutationFn: () => call("roles.set", draft),
    onSuccess: (b) => {
      qc.setQueryData(["roles"], b);
      useUiStore.getState().clearForm("roleModels");
    },
  });
  const list = models.data ?? [];
  return (
    <div className="grid max-w-5xl gap-4">
      <DecisionSettings />
      <div>
        {ROLES.map((r) => (
          <RoleRow
            key={r.role}
            {...r}
            models={list}
            value={draft[r.role]?.models ?? []}
            onChange={(m) =>
              useUiStore.getState().setForm("roleModels", {
                ...draft,
                [r.role]: { ...(draft[r.role] ?? {}), models: m },
              })
            }
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save role models
        </Button>
        <Button
          aria-label="Reset model fields"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            useUiStore.getState().clearForm("roleModels");
            save.reset();
          }}
        >
          Reset fields
        </Button>
        {save.isSuccess ? <span className="text-ok">Saved</span> : null}
        {save.error ? <span className="text-danger">{errorMessage(save.error)}</span> : null}
      </div>
      <details className="rounded-md border border-line">
        <summary className="label cursor-pointer px-3 py-2">Catalog · {list.length} models</summary>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-y border-line">
              {["Model", "Roles", "Capabilities", "In $/M", "Out $/M"].map((h) => (
                <th key={h} className="label px-3 py-1.5 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.ref} className="border-b border-line">
                <td className="px-3 py-1 font-mono">{m.ref}</td>
                <td className="px-3 py-1 font-mono text-muted">{m.roles.join(" ") || "–"}</td>
                <td className="px-3 py-1">
                  <CapabilityBadges model={m} />
                </td>
                <td className="num px-3 py-1">{m.inputPerM?.toFixed(2) ?? "–"}</td>
                <td className="num px-3 py-1">{m.outputPerM?.toFixed(2) ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
