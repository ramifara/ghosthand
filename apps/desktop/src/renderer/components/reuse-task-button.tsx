// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
import { useMutation } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { errorMessage } from "../lib/bridge.ts";
import { loadRunTask } from "../lib/reuse-task.ts";
import { useUiStore } from "../stores/ui-store.ts";
import { Button } from "./ui/button.tsx";

export function ReuseTaskButton({
  runId,
  onReady,
  label = "Run again",
}: {
  runId: string;
  onReady: () => void;
  label?: string;
}) {
  const load = useMutation({
    mutationFn: () => loadRunTask(runId),
    onSuccess: (input) => {
      useUiStore.getState().loadTask(input);
      onReady();
    },
  });
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        disabled={load.isPending}
        onClick={() => load.mutate()}
        aria-label={`${label} from run ${runId}`}
      >
        <RotateCcw aria-hidden="true" />
        {load.isPending ? "Loading…" : label}
      </Button>
      {load.error ? (
        <span role="alert" className="max-w-64 text-xs text-danger">
          {errorMessage(load.error)}
        </span>
      ) : null}
    </span>
  );
}
