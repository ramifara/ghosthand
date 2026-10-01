// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors
// CGEvent pointer and keyboard input in global points (top-left origin, the AX coordinate space).
import ApplicationServices
import Foundation

enum Input {
    private static let keyCodes: [String: CGKeyCode] = [
        "enter": 36, "return": 36, "tab": 48, "space": 49, "backspace": 51, "delete": 117, "escape": 53, "esc": 53,
        "arrowleft": 123, "arrowright": 124, "arrowdown": 125, "arrowup": 126, "left": 123, "right": 124,
        "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "meta": 55, "cmd": 55, "command": 55, "shift": 56, "capslock": 57, "alt": 58, "option": 58, "control": 59,
        "ctrl": 59, "controlormeta": 55,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
        "f11": 103, "f12": 111,
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26,
        "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    ]
    private static let modifierFlags: [CGKeyCode: CGEventFlags] = [
        55: .maskCommand, 56: .maskShift, 58: .maskAlternate, 59: .maskControl,
    ]

    private static func post(_ event: CGEvent?) throws {
        guard let event else { throw RpcError(kind: "permission_denied", message: "CGEvent creation failed (Accessibility permission?)") }
        event.post(tap: .cghidEventTap)
    }

    static func move(_ x: Double, _ y: Double) throws {
        try post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left))
    }

    static func click(_ x: Double, _ y: Double, button: String, count: Int) throws {
        let p = CGPoint(x: x, y: y)
        let (down, up, b): (CGEventType, CGEventType, CGMouseButton) = switch button {
        case "right": (.rightMouseDown, .rightMouseUp, .right)
        case "middle": (.otherMouseDown, .otherMouseUp, .center)
        default: (.leftMouseDown, .leftMouseUp, .left)
        }
        try move(x, y)
        let n = max(1, min(3, count))
        for i in 1 ... n {
            let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: p, mouseButton: b)
            d?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: p, mouseButton: b)
            u?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            defer { try? post(u) }
            try post(d)
            usleep(30000)
        }
    }

    static func drag(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) throws {
        try move(x0, y0)
        try post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: CGPoint(x: x0, y: y0), mouseButton: .left))
        defer {
            try? post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: CGPoint(x: x1, y: y1), mouseButton: .left))
        }
        for i in 1 ... 8 {
            let x = x0 + (x1 - x0) * Double(i) / 8
            let y = y0 + (y1 - y0) * Double(i) / 8
            try post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left))
            usleep(15000)
        }
    }

    static func scroll(dx: Double, dy: Double) throws {
        // Pixel units; positive dy scrolls content down (wheel moves toward the user), hence the sign flip.
        try post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(-dy), wheel2: Int32(-dx), wheel3: 0))
    }

    /// Unicode typing, independent of the keyboard layout. Never logged.
    static func type(_ text: String) throws {
        for ch in text {
            if ch == "\n" {
                try combo(["Enter"])
                continue
            }
            let units = Array(String(ch).utf16)
            let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
            down?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
            up?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            defer { try? post(up) }
            try post(down)
            usleep(4000)
        }
    }

    private static func code(_ key: String) throws -> CGKeyCode {
        if let c = keyCodes[key.lowercased()] { return c }
        throw RpcError(kind: "unsupported", message: "unknown key \(key)")
    }

    /// ["Meta","a"] or ["Meta+a"]: modifiers are held as flags; every press is released.
    static func combo(_ keys: [String]) throws {
        var parts: [String] = []
        for k in keys { parts.append(contentsOf: k.count > 1 ? k.split(separator: "+").map(String.init) : [k]) }
        let codes = try parts.map(code)
        var flags: CGEventFlags = []
        for c in codes { if let f = modifierFlags[c] { flags.insert(f) } }
        var pressed: [CGKeyCode] = []
        defer {
            for c in pressed.reversed() {
                let up = CGEvent(keyboardEventSource: nil, virtualKey: c, keyDown: false)
                up?.flags = flags
                try? post(up)
            }
        }
        for c in codes {
            let down = CGEvent(keyboardEventSource: nil, virtualKey: c, keyDown: true)
            down?.flags = flags
            try post(down)
            pressed.append(c)
        }
        usleep(35000)
    }
}
