// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Starts the app API (127.0.0.1:4410, reached through Vite on :4400) and the control API (127.0.0.1:4401).
import { API_PORT, CONTROL_PORT } from "@ghosthand/testbed-kit";
import { createAppApi } from "./app-api.ts";
import { createControlApi } from "./control-api.ts";
import { Testbed } from "./testbed.ts";

const HOST = "127.0.0.1";
const testbed = new Testbed();

const api = Bun.serve({ hostname: HOST, port: API_PORT, fetch: createAppApi(testbed).fetch });
const control = Bun.serve({ hostname: HOST, port: CONTROL_PORT, fetch: createControlApi(testbed).fetch });

console.log(`testbed app API on http://${HOST}:${api.port}/api (proxied by the web app on :4400)`);
console.log(`testbed control API on http://${HOST}:${control.port}`);
