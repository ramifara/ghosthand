// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// Starts the app API (127.0.0.1:4410, reached through Vite on :4400) and the control API (127.0.0.1:4401).
import { API_PORT, CONTROL_PORT, FRAME_PORT, IDP_PORT } from "@ghosthand/testbed-kit";
import { createAppApi } from "./app-api.ts";
import { createControlApi } from "./control-api.ts";
import { createFrameApi } from "./frame-api.ts";
import { createIdpApp } from "./idp-server.ts";
import { Testbed } from "./testbed.ts";

const HOST = "127.0.0.1";
const testbed = new Testbed();

const api = Bun.serve({ hostname: HOST, port: API_PORT, fetch: createAppApi(testbed).fetch });
const control = Bun.serve({ hostname: HOST, port: CONTROL_PORT, fetch: createControlApi(testbed).fetch });

console.log(`testbed app API on http://${HOST}:${api.port}/api (proxied by the web app on :4400)`);
console.log(`testbed control API on http://${HOST}:${control.port}`);

// L4: a second origin serving cross-origin iframe content, writing to the same database.
const frame = Bun.serve({ hostname: HOST, port: FRAME_PORT, fetch: createFrameApi(testbed).fetch });
console.log(`testbed frame origin on http://${HOST}:${frame.port}`);

// L5: TestIdP, a fake identity provider on its own origin for the SSO task.
const idp = Bun.serve({ hostname: HOST, port: IDP_PORT, fetch: createIdpApp(testbed).fetch });
console.log(`testbed TestIdP on http://${HOST}:${idp.port}`);
