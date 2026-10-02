// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Task composer: a free-text goal with a start URL, or a testbed task; plus profile, planner, writer and
// (in plumbing mode) the decision source. Starting a run switches to the live view. Whatever still
// blocks a start is listed next to the button, never left to a silently disabled control. An installed
// app hides the testbed (its tasks need the dev testbed server) unless Setup → Developer turns it on.
import {
  MAX_TASK_GOAL_CHARS,
  type PlannerChoice,
  type StartRunInput,
  type TaskListItem,
  type WriterChoice,
} from "@ghosthand/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert, FlaskConical, Play, RotateCcw, Target } from "lucide-react";
import { useId, useMemo } from "react";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Field, Input, Select, TextArea } from "../components/ui/field.tsx";
import { Panel } from "../components/ui/panel.tsx";
import { SwitchField } from "../components/ui/switch.tsx";
import { call, errorMessage } from "../lib/bridge.ts";
import { cn } from "../lib/cn.ts";
import { useLiveStore } from "../stores/live-store.ts";
import { useUiStore } from "../stores/ui-store.ts";

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
    recent: useId(),
  };
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => call("tasks.list", {}) });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => call("profiles.list", {}) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => call("settings.get", {}) });
  const chatgpt = useQuery({ queryKey: ["chatgpt"], queryFn: () => call("chatgpt.status", {}) });
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: () => call("secrets.list", {}) });
  const info = useQuery({ queryKey: ["app-info"], queryFn: () => call("app.info", {}) });
  const liveStatus = useLiveStore((s) => s.status);
  const engine = useLiveStore((s) => s.engine);

  const draft = useUiStore((state) => state.composer);
  const recentTasks = useUiStore((state) => state.recentTasks);
  const patch = useUiStore((state) => state.patchComposer);
  const { taskId, goal, startUrl, profile, planner, writer, decision, showBrowser, unattended } = draft;

  const s = settings.data;
  // Until the app says which build this is, nothing testbed-related is drawn (no flash in a release).
  const testbedShown = info.data !== undefined && (!info.data.packaged || (s?.devTestbed ?? false));
  const source = testbedShown ? draft.source : "goal";
  const hasJev = secrets.data?.names.includes("TYPESAFE_API_KEY") ?? false;
  const chatgptPlan = (chatgpt.data?.enabled && chatgpt.data.signedIn) ?? false;
  const plumbing = s?.devPlumbingMode ?? false;
  const effectiveDecision = decision ?? (hasJev ? "jev" : plumbing ? "heuristic" : "jev");
  const selectedTask = useMemo(() => tasks.data?.find((t) => t.id === taskId), [tasks.data, taskId]);

  const start = useMutation({
    mutationFn: (input: StartRunInput) => call("runs.start", input),
    onSuccess: (r, input) => {
      useUiStore.getState().rememberRun(r.runId, input);
      // The host can finish or pause a fast run before the start reply reaches the renderer.
      if (useLiveStore.getState().runId !== r.runId) {
        useLiveStore.getState().reset();
        useLiveStore.setState({ runId: r.runId, status: "running" });
      }
      onStarted(r.runId);
    },
  });

  const busy = liveStatus !== undefined && liveStatus !== "ended";
  const goalLength = goal.trim().length;
  // Everything that still blocks a start, in the order the user would fix it.
  const blockers: string[] = [];
  if (busy) blockers.push("A run is in progress. Stop it from the live view first.");
  if (engine === "crashed")
    blockers.push(
      "The engine stopped and could not be restarted. Open the log in Setup → Developer, then restart GhostHand.",
    );
  if (source === "testbed") {
    if (selectedTask === undefined) blockers.push("Pick a testbed task from the list.");
  } else {
    if (goalLength === 0) blockers.push("Write a goal.");
    else if (goalLength > MAX_TASK_GOAL_CHARS)
      blockers.push(`Shorten the goal to ${MAX_TASK_GOAL_CHARS.toLocaleString()} characters.`);
    if (!/^https?:\/\/.+/.test(startUrl))
      blockers.push("Enter a start URL that begins with http:// or https://.");
  }
  if (effectiveDecision === "heuristic") {
    if (!plumbing)
      blockers.push(
        "Plumbing mode is off (Setup → Developer). Switch Decision to Jev, or turn plumbing mode on.",
      );
  } else if (!hasJev) {
    blockers.push(
      chatgptPlan
        ? "Your ChatGPT plan covers planning and writing, not the step decisions. Add a TypeSafe key in Setup → Providers to run with Jev."
        : "Add a TypeSafe key in Setup → Providers to run with Jev.",
    );
  }
  const ready = blockers.length === 0;

  const submit = () => {
    if (!ready) return;
    start.mutate({
      source:
        source === "testbed"
          ? { kind: "testbed", taskId: taskId ?? "" }
          : { kind: "goal", goal: goal.trim(), startUrl, allowOrigins: draft.allowOrigins },
      profile: profile ?? s?.defaultProfile ?? "default",
      planner: planner ?? s?.planner ?? "auto",
      writer: writer ?? s?.writer ?? "auto",
      decision: effectiveDecision,
      showBrowser: showBrowser ?? s?.showBrowser ?? true,
      unattended,
    });
  };

  return (
    <div
      className={cn(
        "grid h-full gap-3 p-3",
        testbedShown ? "grid-cols-[minmax(340px,420px)_1fr]" : "grid-cols-[minmax(340px,560px)]",
      )}
    >
      <Panel title="New task" bodyClassName="overflow-y-auto">
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">Your draft stays here when you change pages.</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                useUiStore.getState().clearComposer();
                start.reset();
              }}
            >
              <RotateCcw aria-hidden="true" />
              Clear inputs
            </Button>
          </div>
          {recentTasks.length > 0 ? (
            <div className="grid gap-1.5">
              <Field
                label="Recent tasks"
                htmlFor={ids.recent}
                hint="Loads the original fields. Press Start run when ready."
              >
                <Select
                  id={ids.recent}
                  value=""
                  onChange={(event) => {
                    const task = recentTasks.find((item) => item.runId === event.target.value);
                    if (task) {
                      useUiStore.getState().loadTask(task.input);
                      start.reset();
                    }
                  }}
                >
                  <option value="">Choose a previous task…</option>
                  {recentTasks.map((task) => (
                    <option key={task.runId} value={task.runId}>
                      {task.input.source.kind === "testbed"
                        ? task.input.source.taskId
                        : task.input.source.goal.slice(0, 80)}{" "}
                      · {new Date(task.startedAt).toLocaleString()}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                size="sm"
                variant="ghost"
                className="justify-self-start"
                onClick={() => useUiStore.getState().clearRecentTasks()}
              >
                Clear recent tasks
              </Button>
            </div>
          ) : null}
          {testbedShown ? (
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
                  onClick={() => patch({ source: key })}
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
          ) : null}

          {source === "goal" ? (
            <>
              <Field
                label="Goal"
                htmlFor={ids.goal}
                hint={`Say what done looks like. Secrets are referred to by name. ${goal.trim().length.toLocaleString()} / ${MAX_TASK_GOAL_CHARS.toLocaleString()} characters.`}
              >
                <TextArea
                  id={ids.goal}
                  rows={4}
                  aria-invalid={goal.trim().length > MAX_TASK_GOAL_CHARS}
                  value={goal}
                  onChange={(e) => patch({ goal: e.target.value })}
                  placeholder="Change my display name to Ada and save the profile"
                />
              </Field>
              {goal.trim().length > MAX_TASK_GOAL_CHARS ? (
                <p role="alert" className="text-danger">
                  Shorten the goal to {MAX_TASK_GOAL_CHARS.toLocaleString()} characters before starting.
                </p>
              ) : null}
              <Field label="Start URL" htmlFor={ids.url}>
                <Input
                  id={ids.url}
                  value={startUrl}
                  onChange={(e) => patch({ startUrl: e.target.value })}
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
                onChange={(e) => patch({ profile: e.target.value })}
              >
                {[
                  ...new Set([
                    profile ?? s?.defaultProfile ?? "default",
                    ...(profiles.data ?? []).map((p) => p.name),
                  ]),
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
                onChange={(e) => patch({ decision: e.target.value === "heuristic" ? "heuristic" : "jev" })}
              >
                <option value="jev" disabled={!hasJev}>
                  Jev{hasJev ? "" : " (no key)"}
                </option>
                {plumbing || decision === "heuristic" ? (
                  <option value="heuristic" disabled={!plumbing}>
                    Heuristic (plumbing{plumbing ? "" : " off"})
                  </option>
                ) : null}
              </Select>
            </Field>
            <Field label="Planner" htmlFor={ids.planner}>
              <Select
                id={ids.planner}
                value={planner ?? s?.planner ?? "auto"}
                onChange={(e) => patch({ planner: e.target.value as PlannerChoice })}
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
                onChange={(e) => patch({ writer: e.target.value as WriterChoice })}
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
            onChange={(showBrowser) => patch({ showBrowser })}
          />
          <SwitchField
            label="Run without handover"
            hint="No approval prompts and more retries and replans before giving up. Anything on the task's forbidden list is still refused; CAPTCHAs and phone checks pause for you."
            checked={unattended}
            onChange={(unattended) => patch({ unattended })}
          />

          {effectiveDecision === "heuristic" ? (
            <p className="rounded-[5px] border border-amber/40 bg-amber-soft px-3 py-2 text-xs text-amber">
              Plumbing mode: a rule-based stand-in replaces Jev. Use it to check the app end to end, not to
              judge the agent.
            </p>
          ) : null}
          {blockers.length > 0 ? (
            <div
              role="status"
              aria-label="Before you can start"
              className="rounded-[5px] border border-line bg-panel-2 px-3 py-2 text-xs"
            >
              <p className="label mb-1">Before you can start</p>
              <ul className="grid gap-1 text-muted">
                {blockers.map((b) => (
                  <li key={b} className="flex gap-1.5">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-amber" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {start.error ? (
            <p
              role="alert"
              className="rounded-[5px] border border-danger/40 bg-danger-soft px-3 py-2 text-danger"
            >
              The run did not start: {errorMessage(start.error)}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            {chatgptPlan ? (
              <Badge
                tone="accent"
                title="Planner and writer calls use your ChatGPT plan. Jev still decides each step and needs the TypeSafe key."
              >
                Using ChatGPT plan
              </Badge>
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

      {testbedShown ? (
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
                patch({ source: "testbed", taskId: id });
              }}
            />
          )}
        </Panel>
      ) : null}
    </div>
  );
}
