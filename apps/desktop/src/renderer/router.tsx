// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Code-based routes on hash history (works the same under app:// and the dev server).
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell.tsx";
import { ComposerPage } from "./pages/composer-page.tsx";
import { LivePage } from "./pages/live-page.tsx";
import { ReplayPage } from "./pages/replay-page.tsx";
import { RunsPage } from "./pages/runs-page.tsx";
import { SettingsPage } from "./pages/settings-page.tsx";

const rootRoute = createRootRoute({ component: AppShell });

function ComposerRoute() {
  const navigate = useNavigate();
  return <ComposerPage onStarted={() => void navigate({ to: "/live" })} />;
}

function RunsRoute() {
  const navigate = useNavigate();
  return (
    <RunsPage
      onOpen={(runId) => void navigate({ to: "/runs/$runId", params: { runId } })}
      onTaskReady={() => void navigate({ to: "/" })}
    />
  );
}

function ReplayRoute() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const navigate = useNavigate();
  return <ReplayPage runId={runId} onTaskReady={() => void navigate({ to: "/" })} />;
}

function LiveRoute() {
  const navigate = useNavigate();
  return (
    <LivePage
      onOpenReplay={(runId) => void navigate({ to: "/runs/$runId", params: { runId } })}
      onNewTask={() => void navigate({ to: "/" })}
    />
  );
}

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: ComposerRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/live", component: LiveRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs", component: RunsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/runs/$runId", component: ReplayRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
