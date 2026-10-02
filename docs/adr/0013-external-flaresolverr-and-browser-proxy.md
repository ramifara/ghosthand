<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0013. External FlareSolverr and browser proxy

- Status: accepted by Rami
- Date: 2026-10-02

## Context

Rami requested an optional user-operated FlareSolverr connection on top of ADR 0012. GhostHand must not bundle, install or start the service. FlareSolverr uses a JSON API, rather than a browser's HTTP CONNECT proxy interface. Its returned clearance cookies require the returned user agent. This needs a separate decision because ADR 0012 keeps the native user agent and its existing human takeover behavior.

## Decision

- Add separate, optional browser proxy and FlareSolverr settings to desktop and shared CLI/QA configuration. Both default to disabled. Users enter a proxy server URL, a FlareSolverr endpoint, an origin list and a bounded timeout. Authentication uses secret names from the existing credential store, rather than passwords in settings or CLI arguments.
- A normal HTTP/SOCKS proxy goes into Playwright's browser launch options. FlareSolverr goes through its external `/v1` API. If both are configured, give both browsers the same upstream proxy so their traffic uses the same exit.
- When FlareSolverr is enabled for the run's starting origin, perform one `request.get` before the agent starts acting. Send the starting URL, rather than the user's existing profile cookies. Import validated cookies for that origin and use the returned user agent when launching the real browser. The other device properties remain those of the actual browser host. Document that the two browsers can still differ and clearance can still fail.
- Require the target to pass the task's origin restrictions and the user's explicit FlareSolverr origin list. Validate the returned URL before importing cookies. A remote FlareSolverr instance controls its own browser and redirects outside GhostHand's network guard; its operator must control its network access.
- Use a temporary service session only when required for authenticated upstream proxy support. Destroy only that session when preparation finishes. Never destroy user-managed sessions. Do not retry solver requests or agent mutations.
- If preparation fails, return a clear startup error without logging response bodies, cookies, authentication or typed credentials. The user can disable the option and use normal takeover. Any challenge still present in the agent's browser follows the existing human takeover path. Phone checks and model-provider safety checks retain their existing handling.
- Add connection fields under Setup → Browser, plus config documentation and tests against a local fake service. Verify ordinary proxy routing with a local test proxy. Live FlareSolverr acceptance remains conditional on a user-provided endpoint; no service is installed as part of development or shipped with GhostHand.

## Consequences

This prepares a browser session once at startup; it does not route every browser request through FlareSolverr or solve every kind of CAPTCHA. Enabling it sends the configured starting URL to the user's service and opts into that service's browser preparation. A standard proxy remains useful independently of FlareSolverr.

## References

- [FlareSolverr API, proxy support and user-agent requirement](https://github.com/FlareSolverr/FlareSolverr#usage)
- [Playwright persistent contexts and proxy options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
