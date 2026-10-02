<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# Web browser behavior

Desktop runs have these controls under **Setup → Browser**. Save them before starting a web run. CLI CUA and QA runs use the same behavior through `ghosthand.config.ts` or flags. All options are off by default, so existing tests keep their input speed and viewport.

```sh
bun run ghosthand run --url https://example.com --profile work \
  --reduce-automation-markers --human-input --native-window \
  --locale en-US --timezone Europe/Berlin "Find the contact page"

bun run ghosthand test apps/testbed/specs/profile.md --decision heuristic --vision none \
  --headless --human-input --reduce-automation-markers
```

For settings shared by CLI, QA and MCP launches, export a config:

```ts
import { defineConfig } from "@ghosthand/engine";

export const config = defineConfig({
  browser: {
    profile: "work",
    behavior: {
      reduceAutomationMarkers: true,
      inputPacing: "human",
      nativeWindow: true,
      locale: "en-US",
      timezoneId: "Europe/Berlin",
    },
  },
});
```

Explicit CLI flags override the matching config fields. Use `--config <path>` for a separate test configuration. Desktop saves its own browser behavior and uses it for its web CUA runs.

| Option | Behavior |
| --- | --- |
| `reduceAutomationMarkers` | Removes Chromium's `--enable-automation` flag and disables Blink's `AutomationControlled` feature. Other required Playwright flags and profile keyring settings stay in place. |
| `nativeWindow` | Uses the browser's actual window dimensions instead of the configured fixed viewport. |
| `locale` | Sets the browser language through Playwright. Omit it for the browser default. |
| `timezoneId` | Sets the browser timezone through Playwright. Omit it for the host timezone. |
| `inputPacing: "human"` | Adds varied pauses, curved mouse travel, per-character typing and smaller wheel increments. `"instant"` keeps the original timing. |

Named profiles retain cookies and browser storage. Reuse the same profile and behavior settings to keep language, timezone and sizing consistent between runs. The browser describes the machine running GhostHand, including its actual fonts, graphics, plugins and user agent. These options do not simulate the remote device viewing GhostHand. Native sizing varies when the real window or display changes; keep a fixed viewport when comparing screenshots.

Paced typing replaces a field once, then types the requested characters once. It does not introduce deliberate typos or retry mutations. Native selects, numeric/date fields and file inputs keep their existing value-setting routes. Typing adds at most eight seconds of scheduled pauses per value; action timings and the run budget include the added time. Sensitive values use one Playwright typing call with a varied delay per field, so traces can redact the whole value without retaining individual character actions. Secret values still resolve inside the driver and are redacted from recorded evidence.

Marker reduction is best effort. Sites can use other signals, and browser updates can change detection behavior. It does not guarantee that a site accepts the run. History, fonts and graphics remain those of the selected profile and browser host.

GhostHand now ignores incidental CAPTCHA vendor mentions, attribution links and completed verification checkboxes when deciding whether to pause. Active verification instructions and CAPTCHA controls still use human takeover. Ordinary actions continue to use target freshness, hit testing, origin restrictions and effect verification.

Implementation decision: [ADR 0012](adr/0012-browser-compatibility-and-input-pacing.md). Browser APIs: [Playwright persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) and [sequential typing](https://playwright.dev/docs/api/class-locator#locator-press-sequentially).

## External FlareSolverr and browser proxy

Setup → Browser also accepts an external FlareSolverr endpoint and a separate browser proxy. Both are optional and disabled by default. GhostHand does not bundle, install or start either service. Add credential values under Setup → Providers, then enter their names in Browser settings. CLI and QA resolve credential names from `~/.config/ghosthand/env` (mode 0600), or the file selected by `GHOSTHAND_ENV_FILE`.

Add `network` alongside `behavior` in the config's `browser` object:

```ts
network: {
  proxy: {
    enabled: true,
    server: "http://proxy.example.com:8080",
    usernameSecretRef: "PROXY_USERNAME",
    passwordSecretRef: "PROXY_PASSWORD",
  },
  flaresolverr: {
    enabled: true,
    endpoint: "http://127.0.0.1:8191",
    origins: ["https://app.example.com"],
    timeoutMs: 60000,
    // Optional bearer authentication for a gateway in front of the service:
    bearerSecretRef: "FLARESOLVERR_TOKEN",
  },
},
```

Proxy servers accept `http://`, `https://`, `socks4://` and `socks5://`. Username and password names must be supplied together; omit both for an unauthenticated proxy. Chromium supports authentication for HTTP proxies only. Server URLs cannot contain passwords, query parameters or fragments. The FlareSolverr endpoint accepts a base URL or a `/v1` URL, including a gateway path prefix. Its timeout ranges from 1 to 120 seconds.

FlareSolverr is an API for preparing a page, rather than a proxy for every browser request. For a listed starting origin, GhostHand sends one GET preparation request before opening the browser. It sends the starting URL without the user's profile cookies. It validates the response, imports cookies whose domains match the starting host, and uses the returned user agent. Existing profile cookies take precedence except for `cf_clearance`, which may be refreshed. Imported cookie values enter the driver's secret redaction registry. Unlisted starting origins skip preparation.

When both options are enabled, GhostHand supplies the same upstream proxy to FlareSolverr and the browser. The proxy must be reachable from both hosts; `127.0.0.1` refers to each service's own machine. Authenticated upstream proxies use a temporary service session that GhostHand destroys after preparation. GhostHand does not modify user-managed FlareSolverr sessions or retry preparation requests.

The returned user agent is an exception to the normal host-native identity described above. Clearance can still fail if the external browser, host properties or network exit differ. A remaining active challenge uses human takeover. Preparation errors stop startup with a message; disable the option to run with the normal takeover flow.

Only explicitly listed origins are prepared, and blocked task origins remain blocked. The returned page URL must also be listed and allowed. FlareSolverr operates its own browser, so its operator controls that browser's redirects and network access. GhostHand omits service response bodies and credentials from errors. The external service may log request details, including upstream proxy credentials; configure its logging accordingly.

Decision and API references: [ADR 0013](adr/0013-external-flaresolverr-and-browser-proxy.md), [FlareSolverr usage](https://github.com/FlareSolverr/FlareSolverr#usage) and [Playwright proxy options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).
