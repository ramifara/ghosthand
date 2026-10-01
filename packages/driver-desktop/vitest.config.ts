// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Sandbox tests start a container (Xvfb, AT-SPI, a GTK app); they are slow and skip without docker/podman.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ghosthand/driver-desktop",
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
