// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// RPC methods over the macOS Accessibility API. Rules (plan §3.2): only refs of the latest snapshot act and are
// never re-resolved; AX actions and AXValue first, CGEvent only as a fallback; every act returns read-backs.
// Coordinates: AX frames and CGEvents use global points (top-left origin); screenshots are pixels, so the
// capture scale is the backing scale factor (points vs pixels).
import AppKit
import ApplicationServices
import Foundation

final class Host {
    private let protocolVersion = 1
    private let hostVersion = "0.1.0"
    private var pids = Set<pid_t>()
    private var latest: [AXUIElement] = []
    private var latestId: String?
    private var seq = 0

    func handlers() -> [String: Handler] {
        [
            "hello": hello, "doctor": doctor, "launch": launch, "observe": observe, "act": act, "input": input,
            "screenshot": screenshot, "wait_idle": waitIdle, "record_start": recordStart, "record_stop": recordStop,
            "close": close,
        ]
    }

    private var scale: Double { Double(NSScreen.main?.backingScaleFactor ?? 1) }

    private var screenPoints: CGRect { NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900) }

    // ---- scope ---------------------------------------------------------------------------------

    private func appWindows(desktop: Bool = false) -> [AXUIElement] {
        var targets = Array(pids)
        if targets.isEmpty || desktop, let front = NSWorkspace.shared.frontmostApplication {
            targets = desktop ? NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map(\.processIdentifier) : [front.processIdentifier]
        }
        var windows: [AXUIElement] = []
        for pid in targets {
            let app = AXUIElementCreateApplication(pid)
            windows.append(contentsOf: (AX.attr(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? [])
        }
        return windows
    }

    private func global() -> Json {
        let windows = appWindows()
        var o: Json = [
            "windows": windows.map { "\(AX.subrole($0) ?? AX.role($0)):\(AX.label($0))" },
            "events": 0,
            "contentHash": AX.contentHash(windows),
        ]
        if let front = NSWorkspace.shared.frontmostApplication {
            let app = AXUIElementCreateApplication(front.processIdentifier)
            if let main = AX.attr(app, kAXMainWindowAttribute as String) {
                o["activeWindow"] = AX.label(main as! AXUIElement)
            }
            if let focused = AX.attr(app, kAXFocusedUIElementAttribute as String) {
                let f = focused as! AXUIElement
                o["focused"] = "\(AX.role(f)):\(AX.label(f))"
            }
        }
        return o
    }

    private func focusedElement() -> AXUIElement? {
        let system = AXUIElementCreateSystemWide()
        guard let f = AX.attr(system, kAXFocusedUIElementAttribute as String) else { return nil }
        return (f as! AXUIElement)
    }

    // ---- methods -------------------------------------------------------------------------------

    func hello(_ p: Json) throws -> Any {
        [
            "protocolVersion": protocolVersion,
            "host": ["name": "ghosthand-desktop-host-macos", "version": hostVersion],
            "platform": "macos",
            "capabilities": [
                "semanticActions": true,
                "pointer": AXIsProcessTrusted(),
                "screenshots": true,
                "recording": false,
                "boundsTrust": "exact",
            ] as Json,
            "screen": ["width": Double(screenPoints.width), "height": Double(screenPoints.height), "scale": scale],
        ] as Json
    }

    func doctor(_ p: Json) throws -> Any {
        let trusted = AXIsProcessTrusted()
        var checks: [Json] = [
            ["name": "accessibility", "ok": trusted,
             "detail": trusted ? "trusted" : "not trusted: System Settings > Privacy & Security > Accessibility, add your terminal"],
            ["name": "screen", "ok": true, "detail": "\(Int(screenPoints.width))x\(Int(screenPoints.height)) pt, scale \(scale)"],
        ]
        let capture = CGPreflightScreenCaptureAccess()
        checks.append(["name": "screen recording", "ok": true,
                       "detail": capture ? "allowed" : "not allowed (screenshots show only the desktop); grant it in Privacy & Security"])
        return ["checks": checks] as Json
    }

    func launch(_ p: Json) throws -> Any {
        guard let argv = p["argv"] as? [String], let first = argv.first else {
            throw RpcError(kind: "launch_failed", message: "argv is empty")
        }
        let before = Set(NSWorkspace.shared.runningApplications.map(\.processIdentifier))
        let proc = Process()
        if first.hasPrefix("/") && FileManager.default.isExecutableFile(atPath: first) {
            proc.executableURL = URL(fileURLWithPath: first)
            proc.arguments = Array(argv.dropFirst())
        } else {
            // An app name ("TextEdit") or bundle path: open a new instance through LaunchServices.
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            var args = ["-n", "-a", first]
            if argv.count > 1 {
                args.append("--args")
                args.append(contentsOf: argv.dropFirst())
            }
            proc.arguments = args
        }
        do {
            try proc.run()
        } catch {
            throw RpcError(kind: "launch_failed", message: "cannot start \(first): \(error.localizedDescription)")
        }
        let waitMs = p["waitMs"] as? Int ?? 15000
        let deadline = Date().addingTimeInterval(Double(waitMs) / 1000)
        var found: NSRunningApplication?
        while Date() < deadline, found == nil {
            let apps = NSWorkspace.shared.runningApplications.filter { !before.contains($0.processIdentifier) && $0.activationPolicy == .regular }
            found = apps.first { $0.processIdentifier == proc.processIdentifier } ?? apps.first
            // NSWorkspace updates runningApplications on the run loop; a CLI must spin it to see new apps.
            if found == nil { RunLoop.current.run(until: Date().addingTimeInterval(0.15)) }
        }
        guard let app = found else { throw RpcError(kind: "launch_failed", message: "no app window from \(first) within \(waitMs) ms") }
        pids.insert(app.processIdentifier)
        app.activate(options: [])
        var title: String?
        while Date() < deadline, title == nil {
            let ax = AXUIElementCreateApplication(app.processIdentifier)
            if let windows = AX.attr(ax, kAXWindowsAttribute as String) as? [AXUIElement], let w = windows.first {
                title = AX.label(w)
            } else {
                RunLoop.current.run(until: Date().addingTimeInterval(0.15))
            }
        }
        _ = quiet(cap: 2000, quiet: 300)
        var o: Json = ["pid": Int(app.processIdentifier)]
        if let title { o["windowTitle"] = title }
        return o
    }

    func observe(_ p: Json) throws -> Any {
        guard AXIsProcessTrusted() else {
            throw RpcError(kind: "permission_denied", message: "Accessibility permission missing for this process")
        }
        let start = Date()
        let walk = AX.Walk(maxNodes: p["maxNodes"] as? Int ?? 2000, maxDepth: p["maxDepth"] as? Int ?? 40,
                           timeout: Double(p["timeoutMs"] as? Int ?? 5000) / 1000)
        walk.run(appWindows(desktop: p["scope"] as? String == "desktop"))
        seq += 1
        let id = "m\(seq)"
        if p["transient"] as? Bool != true {
            latestId = id
            latest = walk.elements
        }
        var o: Json = [
            "snapshotId": id,
            "takenAt": Int(Date().timeIntervalSince1970 * 1000),
            "screen": AX.rectJson(CGRect(origin: .zero, size: screenPoints.size)),
            "scale": scale,
            "title": (global()["activeWindow"] as? String) ?? "",
            "nodes": walk.nodes,
            "complete": walk.complete,
            "walkMs": Int(Date().timeIntervalSince(start) * 1000),
        ]
        if let d = walk.degraded { o["degradedReason"] = d }
        return o
    }

    private func resolve(_ p: Json) throws -> AXUIElement {
        let sid = p["snapshotId"] as? String
        let ref = p["ref"] as? Int ?? -1
        guard sid == latestId else { throw RpcError(kind: "stale_token", message: "snapshot \(sid ?? "?") is not the latest; observe again") }
        guard ref >= 0, ref < latest.count else { throw RpcError(kind: "stale_token", message: "ref \(ref) is not in snapshot \(sid ?? "?")") }
        let el = latest[ref]
        guard AX.probe(el) != nil else { throw RpcError(kind: "stale_token", message: "the element of ref \(ref) is gone; observe again") }
        return el
    }

    @discardableResult
    private func quiet(cap: Int, quiet: Int) -> (Int, String) {
        let start = Date()
        var last = AX.contentHash(appWindows(), budget: 400)
        var since = Date()
        while true {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            let h = AX.contentHash(appWindows(), budget: 400)
            if h != last {
                last = h
                since = Date()
            }
            let waited = Int(Date().timeIntervalSince(start) * 1000)
            if Int(Date().timeIntervalSince(since) * 1000) >= quiet { return (waited, "quiet") }
            if waited >= cap { return (waited, "cap") }
        }
    }

    private func perform(_ el: AXUIElement, _ action: String) throws {
        let err = AXUIElementPerformAction(el, action as CFString)
        if err != .success { throw RpcError(kind: "driver", message: "\(action) failed (\(err.rawValue))") }
    }

    private func pointerClick(_ el: AXUIElement) throws -> (String, String) {
        guard let f = AX.frame(el) else { throw RpcError(kind: "not_interactable", message: "no action and no frame") }
        try Input.click(Double(f.midX), Double(f.midY), button: "left", count: 1)
        return ("pointer", "cgevent.click")
    }

    private func dispatch(_ op: String, _ el: AXUIElement, _ p: Json, _ before: Json?) throws -> (String, String) {
        let actions = AX.actions(el)
        switch op {
        case "press":
            for a in ["AXPress", "AXConfirm", "AXPick", "AXOpen"] where actions.contains(a) {
                try perform(el, a)
                return ("semantic", "ax.\(a)")
            }
            if AX.settable(el, kAXSelectedAttribute as String) {
                AXUIElementSetAttributeValue(el, kAXSelectedAttribute as CFString, kCFBooleanTrue)
                return ("semantic", "ax.set(AXSelected)")
            }
            return try pointerClick(el)
        case "set_value":
            let value = p["value"] as? String ?? ""
            if AX.settable(el, kAXValueAttribute as String) {
                let err = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, value as CFTypeRef)
                let after = AX.probe(el)
                if err == .success, after?["value"] as? String == value || after?["valueLength"] as? Int == value.count {
                    return ("semantic", "ax.set(AXValue)")
                }
            }
            // Idempotent keyboard fallback when the semantic route changed nothing: focus, select all, type.
            let now = AX.probe(el)
            let unchanged = (now?["value"] as? String) == (before?["value"] as? String)
                && (now?["valueLength"] as? Int) == (before?["valueLength"] as? Int)
            guard unchanged else { return ("semantic", "ax.set(AXValue)") }
            AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            try Input.combo(["Meta", "a"])
            try Input.type(value)
            return ("keyboard", "cgevent.type")
        case "toggle":
            let states = before?["states"] as? [String] ?? []
            if let want = p["checked"] as? Bool, want == states.contains("checked") { return ("semantic", "noop.already_in_state") }
            if actions.contains("AXPress") {
                try perform(el, "AXPress")
                return ("semantic", "ax.AXPress")
            }
            return try pointerClick(el)
        case "select_option":
            return try selectOption(el, p["option"] as? String ?? "")
        case "focus":
            let err = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            if err != .success { throw RpcError(kind: "not_interactable", message: "focus refused (\(err.rawValue))") }
            return ("semantic", "ax.set(AXFocused)")
        case "scroll_into_view":
            if actions.contains("AXScrollToVisible") {
                try perform(el, "AXScrollToVisible")
                return ("semantic", "ax.AXScrollToVisible")
            }
            return ("semantic", "noop.no_scroll_action")
        case "select_text":
            let text = p["text"] as? String ?? ""
            guard let full = AX.valueString(el), let range = full.range(of: text, options: .caseInsensitive) else {
                throw RpcError(kind: "not_found", message: "text not found in the element")
            }
            var cf = CFRange(location: full.distance(from: full.startIndex, to: range.lowerBound), length: text.count)
            guard let axRange = AXValueCreate(.cfRange, &cf) else { throw RpcError(kind: "driver", message: "AXValueCreate failed") }
            let err = AXUIElementSetAttributeValue(el, kAXSelectedTextRangeAttribute as CFString, axRange)
            if err != .success { throw RpcError(kind: "driver", message: "selection refused (\(err.rawValue))") }
            return ("semantic", "ax.set(AXSelectedTextRange)")
        default:
            throw RpcError(kind: "unsupported", message: "unknown op \(op)")
        }
    }

    /// Pop-up buttons: AXPress opens the menu, then AXPress on the matching menu item; lists: AXSelected.
    private func selectOption(_ el: AXUIElement, _ option: String) throws -> (String, String) {
        let want = option.trimmingCharacters(in: .whitespaces).lowercased()
        func find(_ root: AXUIElement, depth: Int = 0) -> AXUIElement? {
            if depth > 6 { return nil }
            for c in AX.children(root) {
                let r = AX.role(c)
                if ["AXMenuItem", "AXRow", "AXCell", "AXStaticText", "AXRadioButton"].contains(r),
                   AX.label(c).trimmingCharacters(in: .whitespaces).lowercased() == want { return c }
                if let hit = find(c, depth: depth + 1) { return hit }
            }
            return nil
        }
        let role = AX.role(el)
        if role == "AXPopUpButton" || role == "AXComboBox" || role == "AXMenuButton" {
            try perform(el, "AXPress")
            usleep(200_000)
            guard let item = find(el) else {
                try? perform(el, "AXCancel")
                throw RpcError(kind: "not_found", message: "no option matches")
            }
            try perform(item, "AXPress")
            return ("semantic", "ax.menu.AXPress")
        }
        guard let item = find(el) else { throw RpcError(kind: "not_found", message: "no option matches") }
        if AX.settable(item, kAXSelectedAttribute as String) {
            AXUIElementSetAttributeValue(item, kAXSelectedAttribute as CFString, kCFBooleanTrue)
            return ("semantic", "ax.set(AXSelected)")
        }
        try perform(item, "AXPress")
        return ("semantic", "ax.AXPress")
    }

    func act(_ p: Json) throws -> Any {
        let op = p["op"] as? String ?? ""
        let el = try resolve(p)
        let g0 = global()
        let before = AX.probe(el)
        latestId = nil
        latest = []
        var route = "semantic"
        var native = ""
        var error: Json?
        do {
            (route, native) = try dispatch(op, el, p, before)
        } catch let e as RpcError where ["not_interactable", "unsupported", "not_found"].contains(e.kind) {
            return [
                "ok": false, "route": "none", "nativeRoute": "", "before": before as Any? ?? NSNull(),
                "after": before as Any? ?? NSNull(), "globalBefore": g0, "globalAfter": g0,
                "error": ["kind": e.kind, "message": e.message] as Json,
            ] as Json
        } catch let e as RpcError {
            error = ["kind": e.kind, "message": e.message]
        }
        let quick = ["set_value", "toggle", "focus", "scroll_into_view", "select_text", "select_option"].contains(op)
        quiet(cap: quick ? 600 : 1500, quiet: quick ? 120 : 250)
        var o: Json = [
            "ok": error == nil, "route": route, "nativeRoute": native, "before": before as Any? ?? NSNull(),
            "after": AX.probe(el) as Any? ?? NSNull(), "globalBefore": g0, "globalAfter": global(),
        ]
        if let error { o["error"] = error }
        return o
    }

    private func focusedValue() -> Json? {
        guard let f = focusedElement(), let probe = AX.probe(f) else { return nil }
        var o: Json = ["role": AX.role(f), "name": AX.label(f)]
        if let v = probe["value"] { o["value"] = v }
        if let l = probe["valueLength"] { o["valueLength"] = l }
        return o
    }

    func input(_ p: Json) throws -> Any {
        guard AXIsProcessTrusted() else { throw RpcError(kind: "permission_denied", message: "Accessibility permission missing") }
        let op = p["op"] as? String ?? ""
        let g0 = global()
        let f0 = focusedValue()
        latestId = nil
        latest = []
        func d(_ k: String) throws -> Double {
            guard let v = p[k] as? Double ?? (p[k] as? Int).map(Double.init) else { throw RpcError(kind: "driver", message: "\(k) is required") }
            return v
        }
        switch op {
        case "click": try Input.click(try d("x"), try d("y"), button: p["button"] as? String ?? "left", count: p["count"] as? Int ?? 1)
        case "move": try Input.move(try d("x"), try d("y"))
        case "drag": try Input.drag(try d("x"), try d("y"), try d("toX"), try d("toY"))
        case "scroll":
            if p["x"] != nil, p["y"] != nil { try Input.move(try d("x"), try d("y")) }
            try Input.scroll(dx: (p["dx"] as? Double) ?? 0, dy: (p["dy"] as? Double) ?? 0)
        case "type": try Input.type(p["text"] as? String ?? "")
        case "key": try Input.combo(p["keys"] as? [String] ?? [])
        default: throw RpcError(kind: "unsupported", message: "unknown input op \(op)")
        }
        quiet(cap: 1500, quiet: 200)
        var o: Json = [
            "ok": true, "route": ["type", "key"].contains(op) ? "keyboard" : "pointer", "nativeRoute": "cgevent.\(op)",
            "globalBefore": g0, "globalAfter": global(),
        ]
        if let f0 { o["focusedBefore"] = f0 }
        if let f1 = focusedValue() { o["focusedAfter"] = f1 }
        return o
    }

    func screenshot(_ p: Json) throws -> Any {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("ghosthand-\(UUID().uuidString).png")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        var args = ["-x", "-t", "png"]
        if let r = p["region"] as? Json, let x = r["x"] as? Double, let y = r["y"] as? Double,
           let w = r["width"] as? Double, let h = r["height"] as? Double {
            args += ["-R", "\(Int(x)),\(Int(y)),\(Int(w)),\(Int(h))"]
        }
        proc.arguments = args + [tmp.path]
        try proc.run()
        proc.waitUntilExit()
        guard proc.terminationStatus == 0, let data = try? Data(contentsOf: tmp), let image = NSImage(data: data),
              let rep = image.representations.first
        else { throw RpcError(kind: "driver", message: "screencapture failed (Screen Recording permission?)") }
        return [
            "data": data.base64EncodedString(), "mimeType": "image/png",
            "width": rep.pixelsWide, "height": rep.pixelsHigh, "scale": scale,
        ] as Json
    }

    func waitIdle(_ p: Json) throws -> Any {
        let (waited, reason) = quiet(cap: p["capMs"] as? Int ?? 3000, quiet: p["quietMs"] as? Int ?? 250)
        return ["waitedMs": waited, "reason": reason] as Json
    }

    func recordStart(_ p: Json) throws -> Any {
        throw RpcError(kind: "unsupported", message: "recording is not implemented on macOS yet")
    }

    func recordStop(_ p: Json) throws -> Any {
        throw RpcError(kind: "unsupported", message: "not recording")
    }

    func close(_ p: Json) throws -> Any {
        for pid in pids {
            // Ask politely; never force-quit an app that may hold unsaved work.
            NSRunningApplication(processIdentifier: pid)?.terminate()
        }
        return [:] as Json
    }
}
