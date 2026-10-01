// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const driverDesktopPackageName = "@ghosthand/driver-desktop" as const;

export * from "./build-elements.ts";
export * from "./desktop-computer.ts";
export * from "./desktop-effects.ts";
export * from "./launch/connect-host.ts";
export * from "./launch/desktop-doctor.ts";
export * from "./launch/launch-desktop.ts";
export * from "./launch/native-host.ts";
export * from "./launch/system.ts";
export * from "./launch/wayland-sandbox.ts";
export * from "./launch/x11-sandbox.ts";
export * from "./role-map.ts";
export * from "./rpc/rpc-client.ts";
export * from "./testbed/desktop-tasks.ts";
