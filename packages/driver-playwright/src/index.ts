// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const driverPlaywrightPackageName = "@ghosthand/driver-playwright" as const;

export * from "./browser/choose-browser.ts";
export * from "./browser/detect-browsers.ts";
export * from "./browser/host.ts";
export * from "./browser/import-chrome-profile.ts";
export * from "./browser/launch-persistent.ts";
export * from "./browser/profile-commands.ts";
export * from "./browser/profile-error.ts";
export * from "./browser/profile-lock.ts";
export * from "./browser/profile-metadata.ts";
export * from "./browser/profile-name.ts";
export * from "./browser/profile-paths.ts";
export * from "./browser/profile-store.ts";
