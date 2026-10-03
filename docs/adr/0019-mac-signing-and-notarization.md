<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 Rami Fara and GhostHand contributors -->

# 0019. Developer ID signing and notarization for macOS, from any OS

- Status: proposed
- Date: 2026-10-03

## Context

The macOS builds were ad-hoc signed: Gatekeeper blocked the first launch ("unidentified developer" or "damaged"), each build had a new code identity (macOS permissions such as Accessibility reset with every build), and the Keychain asked for the login password on every launch (ADR 0014 worked around that with a local key). The release workflow cannot run while the Actions quota is exhausted (ADR 0018), and macOS runners are the expensive ones. The owner has an Apple Developer Program membership.

## Decision

- Sign with a **Developer ID Application** certificate (team `39YZK3GG8R`) under the **hardened runtime**, with Electron's entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`; `apps/desktop/build/entitlements.mac.plist`) on the app and its helpers, and an Apple secure timestamp.
- **Notarize** with an App Store Connect API key (role Developer) and **staple** the ticket to the bundle, so the app opens offline on first launch.
- Do both with `rcodesign` (apple-codesign; Apache-2.0/MPL-2.0, an external tool, not a dependency), so a signed and notarized Mac build comes from Linux: `bun run dist:desktop:mac-signed` (`scripts/mac-release.ts`). electron-builder packages the app unsigned; the script signs, submits, polls the verdict with `fetch`, staples and writes a zip that keeps the bundle's symlinks.
- Credentials never enter the repository: `~/.config/ghosthand/signing/` (mode 0700) holds the private key (generated on the build machine; only its certificate request went to Apple), the certificate, and the API key file. The certificate request and the issuer and key IDs are not secret.
- Apple's time-stamp host resolves to IPv6 first; on a host without an IPv6 route the script uses its IPv4 address (plain HTTP). The notary status is polled with Node's `fetch`, which falls back to IPv4, because `rcodesign`'s own polling failed on such a host.

## Consequences

Signed, notarized builds open with a double-click and keep one identity across versions; secrets can return to the Keychain for signed builds (a follow-up to ADR 0014). The first notarization of a team can take hours; later ones usually take minutes. Windows builds remain unsigned until a code-signing certificate (for example Azure Trusted Signing) is chosen. The release workflow can adopt the same script once the Actions quota is restored, with the credentials as repository secrets.
