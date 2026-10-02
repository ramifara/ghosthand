// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Task composer: a free-text goal with a start URL, or a testbed task; plus profile, planner, writer and
// (in plumbing mode) the decision source. Starting a run switches to the live view.
import type { PlannerChoice, StartRunInput, TaskListItem, WriterChoice } from "@ghosthand/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical, Play, Target } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Field, Input, Select, TextArea } from "../components/ui/field.tsx";
import { Panel } from "../components/ui/panel.tsx";
import { SwitchField } from "../components/ui/switch.tsx";
import { call, errorMessage } from "../lib/bridge.ts";
import { cn } from "../lib/cn.ts";
import { useLiveStore } from "../stores/live-store.ts";

type Source = "testbed" | "goal";

function TaskPicker({
  tasks,
  value,
  onChange,
}: {
  tasks: readonly TaskListItem[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const levels = [...new Set(tasks.map((t) => t.level))].sort();
  return (
    <fieldset aria-label="Testbed task" className="m-0 min-w-0 divide-y divide-line border-0 p-0">
      {levels.map((level) => (
        <div key={level}>
          <p className="label sticky top-0 bg-panel px-3 py-1.5">Level {level}</p>
          {tasks
            .filter((t) => t.level === level)
            .map((t) => {
              const checked = t.id === value;
              return (
                <label
                  key={t.id}
                  className={cn(
                    "grid w-full cursor-pointer grid-cols-[1rem_10rem_1fr] items-start gap-2 px-3 py-2 hover:bg-panel-2",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-[var(--focus)]",
                    checked && "bg-accent-soft hover:bg-accent-soft",
                  )}
                >
                  <input
                    type="radio"
                    name="testbed-task"
                    value={t.id}
                    checked={checked}
                    onChange={() => onChange(t.id)}
                    className="mt-1 size-3 accent-[var(--accent)] focus-visible:outline-none"
                  />
                  <span className="font-mono text-xs">
                    {t.id}
                    <span className="text-faint">@{t.version}</span>
                  </span>
                  <span className="text-muted">{t.instruction}</span>
                </label>
              );
            })}
        </div>
      ))}
    </fieldset>
  );
}

export function ComposerPage({ onStarted }: { onStarted: (runId: string) => void }) {
  const ids = {
    goal: useId(),
    url: useId(),
    profile: useId(),
    planner: useId(),
    writer: useId(),
    decision: useId(),
  };
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => call("tasks.list", {}) });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => call("profiles.list", {}) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const chatgpt = useQuery({ queryKey: ["chatgpt"], queryFn: () => call("chatgpt.status", {}) });
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: () => call("secrets.list", {}) });
  const liveStatus = useLiveStore((s) => s.status);

  const [source, setSource] = useState<Source>("testbed");
  const [taskId, setTaskId] = useState<string>();
  const [goal, setGoal] = useState("");
  const [startUrl, setStartUrl] = useState("https://");
  const [profile, setProfile] = useState<string>();
  const [planner, setPlanner] = useState<PlannerChoice>();
  const [writer, setWriter] = useState<WriterChoice>();
  const [decision, setDecision] = useState<"jev" | "heuristic">();
  const [showBrowser, setShowBrowser] = useState<boolean>();
  const [unattended, setUnattended] = useState(false);

  const s = settings.data;
  const hasJev = secrets.data?.names.includes("TYPESAFE_API_KEY") ?? false;
  const plumbing = s?.devPlumbingMode ?? false;
  const effectiveDecision = decision ?? (hasJev ? "jev" : plumbing ? "heuristic" : "jev");
  const selectedTask = useMemo(() => tasks.data?.find((t) => t.id === taskId), [tasks.data, taskId]);

  const start = useMutation({
    mutationFn: (input: StartRunInput) => call("runs.start", input),
    onSuccess: (r) => {
      useLiveStore.getState().reset();
      useLiveStore.setState({ runId: r.runId, status: "running" });
      onStarted(r.runId);
    },
  });

  const busy = liveStatus !== undefined && liveStatus !== "ended";
  const ready =
    !busy &&
    (source === "testbed"
      ? taskId !== undefined
      : goal.trim().length > 0 && /^https?:\/\/.+/.test(startUrl)) &&
    (effectiveDecision === "heuristic" || hasJev);

  const submit = () => {
    if (!ready) return;
    start.mutate({
      source:
        source === "testbed"
          ? { kind: "testbed", taskId: taskId ?? "" }
          : { kind: "goal", goal: goal.trim(), startUrl, allowOrigins: [] },
      ...(profile ? { profile } : {}),
      ...(planner ? { planner } : {}),
      ...(writer ? { writer } : {}),
      decision: effectiveDecision,
      ...(showBrowser !== undefined ? { showBrowser } : {}),
      ...(unattended ? { unattended } : {}),
    });
  };

  return (
    <div className="grid h-full grid-cols-[minmax(340px,420px)_1fr] gap-3 p-3">
      <Panel title="New task" bodyClassName="overflow-y-auto">
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div
            role="tablist"
            aria-label="Task source"
            className="grid grid-cols-2 rounded-[5px] border border-line-strong p-0.5"
          >
            {(
              [
                ["testbed", "Testbed task", <FlaskConical key="i" />],
                ["goal", "Goal on any site", <Target key="i" />],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={source === key}
                onClick={() => setSource(key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-[3px] py-1.5 text-xs font-medium text-muted [&_svg]:size-3.5",
                  source === key && "bg-accent-soft text-accent",
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          {source === "goal" ? (
            <>
              <Field
                label="Goal"
                htmlFor={ids.goal}
                hint="Say what done looks like. Secrets are referred to by name."
              >
                <TextArea
                  id={ids.goal}
                  rows={4}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Change my display name to Ada and save the profile"
                />
              </Field>
              <Field label="Start URL" htmlFor={ids.url}>
                <Input
                  id={ids.url}
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  className="font-mono"
                />
              </Field>
            </>
          ) : (
            <div className="rounded-[5px] border border-line bg-panel-2 px-3 py-2.5">
              <p className="label mb-1">Selected</p>
              {selectedTask ? (
                <>
                  <p className="font-mono text-xs">{selectedTask.id}</p>
                  <p className="mt-1">{selectedTask.instruction}</p>
                  <p className="mt-1 font-mono text-2xs text-faint">{selectedTask.start}</p>
                </>
              ) : (
                <p className="text-muted">
                  Pick a task from the list. The testbed must be running (bun run dev:testbed).
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Browser profile" htmlFor={ids.profile}>
              <Select
                id={ids.profile}
                value={profile ?? s?.defaultProfile ?? "default"}
                onChange={(e) => setProfile(e.target.value)}
              >
                {[
                  ...new Set([s?.defaultProfile ?? "default", ...(profiles.data ?? []).map((p) => p.name)]),
                ].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Decision" htmlFor={ids.decision}>
              <Select
                id={ids.decision}
                value={effectiveDecision}
                onChange={(e) => setDecision(e.target.value === "heuristic" ? "heuristic" : "jev")}
              >
                <option value="jev" disabled={!hasJev}>
                  Jev{hasJev ? "" : " (no key)"}
                </option>
                {plumbing ? <option value="heuristic">Heuristic (plumbing)</option> : null}
              </Select>
            </Field>
            <Field label="Planner" htmlFor={ids.planner}>
              <Select
                id={ids.planner}
                value={planner ?? s?.planner ?? "auto"}
                onChange={(e) => setPlanner(e.target.value as PlannerChoice)}
              >
                <option value="auto">Auto</option>
                <option value="codex">Codex</option>
                <option value="models">Models layer</option>
                <option value="none">None</option>
              </Select>
            </Field>
            <Field label="Writer" htmlFor={ids.writer}>
              <Select
                id={ids.writer}
                value={writer ?? s?.writer ?? "auto"}
                onChange={(e) => setWriter(e.target.value as WriterChoice)}
              >
                <option value="auto">Auto</option>
                <option value="models">Models layer</option>
                <option value="none">None</option>
              </Select>
            </Field>
          </div>

          <SwitchField
            label="Show the browser window"
            hint="Needed to take over by hand. The live view works either way."
            checked={showBrowser ?? s?.showBrowser ?? true}
            onChange={setShowBrowser}
          />
          <SwitchField
            label="Run without handover"
            hint="No approval prompts and more retries and replans before giving up. Anything on the task's forbidden list is still refused; CAPTCHAs and phone checks pause for you."
            checked={unattended}
            onChange={setUnattended}
          />

          {effectiveDecision === "heuristic" ? (
            <p className="rounded-[5px] border border-amber/40 bg-amber-soft px-3 py-2 text-xs text-amber">
              Plumbing mode: a rule-based stand-in replaces Jev. Use it to check the app end to end, not to
              judge the agent.
            </p>
          ) : null}
          {!hasJev && !plumbing ? (
            <p className="text-xs text-muted">Add a TypeSafe key in Setup → Providers to run with Jev.</p>
          ) : null}
          {start.error ? <p className="text-danger">{errorMessage(start.error)}</p> : null}
          {busy ? (
            <p className="text-xs text-muted">A run is in progress. Stop it from the live view first.</p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            {chatgpt.data?.enabled && chatgpt.data.signedIn ? (
              <Badge tone="accent">Using ChatGPT plan</Badge>
            ) : (
              <span />
            )}
            <Button type="submit" variant="primary" disabled={!ready || start.isPending}>
              <Play aria-hidden="true" />
              {start.isPending ? "Starting…" : "Start run"}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel
        title={`Testbed tasks${tasks.data ? ` · ${tasks.data.length}` : ""}`}
        bodyClassName={cn("overflow-y-auto", source !== "testbed" && "opacity-50")}
      >
        {tasks.isError ? (
          <p className="p-4 text-danger">{errorMessage(tasks.error)}</p>
        ) : (
          <TaskPicker
            tasks={tasks.data ?? []}
            value={taskId}
            onChange={(id) => {
              setSource("testbed");
              setTaskId(id);
            }}
          />
        )}
      </Panel>
    </div>
  );
}
