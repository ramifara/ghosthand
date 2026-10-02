<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0012. Browser compatibility and input pacing

- Status: accepted by Rami
- Date: 2026-10-02

## Context

Rami requested fewer automation markers, consistent device properties and human-like input for both computer-use runs and app testing. Named persistent profiles and installed-browser selection already exist. The current driver uses immediate fills and clicks, while the human-wall detector treats any mention of CAPTCHA vendor names as a blocking challenge. See `docs/research/notes/web-agent-inspiration.md` and `docs/research/notes/jev-web-repos.md` for the existing browser design and action guards.

## Decision

1. Add optional browser compatibility settings shared by engine launches, QA and desktop CUA runs. Keep the current behavior as the default for reproducible tests. Expose the settings in desktop settings and through the CLI/config.
2. Offer automation-marker reduction for Chromium browsers by filtering the automation launch flag and disabling Blink's AutomationControlled feature. Keep required Playwright flags and imported-profile keyring handling. Document this as best effort, and verify it against the installed browser. Do not claim that this hides every automation signal.
3. Use the actual browser and host for fonts, graphics, plugins and user-agent properties. Offer native window sizing and explicit locale/timezone settings through Playwright's supported context options. Keep the selected identity stable across a run and profile reuse. Do not invent plugin lists or inject independently randomized canvas, font or graphics fingerprints. A browser on the agent host describes that host, rather than Rami's remote device.
4. Add optional bounded input pacing in the Playwright driver: varied pauses, mouse travel before clicks and hover, varied key intervals, and smaller scroll increments. Support both element actions and vision/coordinate actions. Preserve target freshness, hit testing, secret resolution/redaction and effect verification. Clear and replace text once, type its characters once, and never retry a mutation. Keep native select/file-upload controls on their existing routes. Account for added time in action timings and run budgets.
5. Reduce unnecessary intervention by distinguishing active human-verification screens from incidental vendor mentions, documentation links and normal content. Test both false-positive cases and real challenge cases. Existing origin restrictions, destructive-action approvals, phone verification handling and provider safety checks retain their behavior. Active CAPTCHA challenges still use the existing human takeover flow.
6. Validate with local browser integration tests and the deterministic testbed without paid model calls. Show the new desktop controls through a temporary loopback preview published on a separate Tailscale HTTPS port, then remove the task-owned process and route at task completion unless Rami asks to keep them.

## Consequences

Paced input takes longer. Marker reduction can break with browser updates and cannot guarantee acceptance by anti-bot systems. Host-native properties avoid contradictions caused by partial fingerprint spoofing. Keeping this optional allows ordinary QA runs to stay fast and repeatable.

This change covers the Playwright web driver used by CUA and QA. Native desktop drivers remain a separate input implementation. Proxy rotation, fingerprint rotation, automatic provider safety acknowledgements and synthetic browsing history are outside this decision. Optional external session preparation and a fixed browser proxy are covered by [ADR 0013](0013-external-flaresolverr-and-browser-proxy.md).

## References

- [Playwright persistent contexts and context options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright sequential typing](https://playwright.dev/docs/api/class-locator#locator-press-sequentially)
- [Chromium automation flag handling](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/chrome_content_browser_client.cc)
- [Navigator.webdriver behavior](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver)
