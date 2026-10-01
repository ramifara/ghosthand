// swift-tools-version:5.9
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// GhostHand desktop RPC host for macOS: AXUIElement actions first (AXPress, AXValue), CGEvent fallback.
import PackageDescription

let package = Package(
    name: "ghosthand-ax-host",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "ghosthand-ax-host",
            path: "Sources/GhostHandAXHost",
            linkerSettings: [
                .linkedFramework("ApplicationServices"),
                .linkedFramework("AppKit"),
            ]
        ),
    ]
)
